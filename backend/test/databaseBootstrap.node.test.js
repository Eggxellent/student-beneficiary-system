'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MIGRATION_ORDER, MANUAL_MIGRATIONS } = require('../scripts/migrate');
const {
  bootstrapIfDatabaseIsEmpty,
  getBootstrapInputs,
  provisionInitialAdmin,
} = require('../scripts/bootstrap-production-schema');

const validEnv = Object.freeze({
  SBMS_EXPECTED_DATABASE_NAME: 'sbms_test',
  SBMS_EMPTY_SCHEMA_BOOTSTRAP_APPROVED: 'sbms_test',
  SBMS_INITIALIZE_EMPTY_DATABASE: 'true',
  SBMS_BOOTSTRAP_ADMIN_NAME: 'Test Administrator',
  SBMS_BOOTSTRAP_ADMIN_EMAIL: 'admin@example.test',
  SBMS_BOOTSTRAP_ADMIN_PASSWORD: 'PrivateTestPassword123',
});

function makeClient({ databaseName = 'sbms_test', relationCount = 0, verification = true } = {}) {
  const calls = [];
  const client = {
    released: false,
    async query(sql, values) {
      calls.push({ sql: String(sql), values });
      if (String(sql).includes('public_object_count')) {
        return { rows: [{ database_name: databaseName, users_exists: relationCount > 0, public_object_count: relationCount }] };
      }
      if (String(sql).includes('missing_user_columns')) {
        return { rows: [verification
          ? { database_name: 'sbms_test', users_exists: true, users_resolve_to_public: true, missing_user_columns: [] }
          : { database_name: 'sbms_test', users_exists: true, users_resolve_to_public: false, missing_user_columns: ['is_active'] }] };
      }
      if (String(sql).includes("SELECT id FROM public.users WHERE role = 'admin'")) return { rows: [] };
      if (String(sql).includes('SELECT id, role FROM public.users WHERE email')) return { rows: [] };
      return { rows: [] };
    },
    release() { this.released = true; },
  };
  return { client, calls };
}

function dependencies(options = {}) {
  const { client, calls } = makeClient(options);
  let connectCount = 0;
  return {
    calls,
    client,
    dbPool: { async connect() { connectCount += 1; return client; }, get connectCount() { return connectCount; } },
    bcryptImpl: { async hash(password, rounds) { assert.equal(password, validEnv.SBMS_BOOTSTRAP_ADMIN_PASSWORD); assert.equal(rounds, 12); return 'bcrypt-hash-only'; } },
    fsImpl: { readFileSync(filePath) { return `-- fixture for ${filePath}`; } },
  };
}

test('empty-schema bootstrap requires explicit target approval and administrator input', () => {
  assert.throws(() => getBootstrapInputs({ ...validEnv, SBMS_EMPTY_SCHEMA_BOOTSTRAP_APPROVED: '' }), /explicit empty-schema approval/);
  assert.throws(() => getBootstrapInputs({ ...validEnv, SBMS_INITIALIZE_EMPTY_DATABASE: 'false' }), /requires SBMS_INITIALIZE_EMPTY_DATABASE=true/);
  assert.throws(() => getBootstrapInputs({ ...validEnv, SBMS_BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' }), /Valid initial administrator/);
  assert.throws(() => getBootstrapInputs({ ...validEnv, SBMS_BOOTSTRAP_ADMIN_PASSWORD: 'short' }), /Valid initial administrator/);
});

test('invalid approval is rejected before opening a database connection', async () => {
  const deps = dependencies();
  await assert.rejects(
    bootstrapIfDatabaseIsEmpty({ ...deps, env: { ...validEnv, SBMS_EMPTY_SCHEMA_BOOTSTRAP_APPROVED: '' } }),
    /explicit empty-schema approval/,
  );
  assert.equal(deps.dbPool.connectCount, 0);
});

test('bootstrap refuses the wrong database and any existing public relation before schema SQL', async () => {
  for (const options of [
    { databaseName: 'another_database', relationCount: 0 },
    { databaseName: 'sbms_test', relationCount: 1 },
  ]) {
    const deps = dependencies(options);
    await assert.rejects(bootstrapIfDatabaseIsEmpty({ ...deps, env: validEnv }));
    assert.equal(deps.calls.some(({ sql }) => sql.startsWith('-- fixture')), false);
    assert.equal(deps.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(deps.client.released, true);
  }
});

test('approved empty bootstrap applies only automatic migrations atomically and stores a bcrypt hash', async () => {
  const deps = dependencies();
  const result = await bootstrapIfDatabaseIsEmpty({ ...deps, env: validEnv });

  assert.deepEqual(result, { status: 'initialized', appliedMigrations: MIGRATION_ORDER.length, adminStatus: 'admin_created' });
  assert.equal(MANUAL_MIGRATIONS.some((name) => deps.calls.some(({ sql }) => sql.includes(name))), false);
  assert.equal(deps.calls.filter(({ sql }) => sql.startsWith('-- fixture')).length, MIGRATION_ORDER.length + 1);
  const insert = deps.calls.find(({ sql }) => sql.includes('INSERT INTO public.users'));
  assert.deepEqual(insert.values, ['Test Administrator', 'admin@example.test', 'bcrypt-hash-only']);
  assert.equal(JSON.stringify(deps.calls).includes(validEnv.SBMS_BOOTSTRAP_ADMIN_PASSWORD), false);
  assert.equal(deps.calls.at(-1).sql, 'COMMIT');
  assert.equal(deps.client.released, true);
});

test('verification failure rolls the schema and initial administrator back together', async () => {
  const deps = dependencies({ verification: false });
  await assert.rejects(bootstrapIfDatabaseIsEmpty({ ...deps, env: validEnv }), /Schema verification failed/);
  assert.equal(deps.calls.some(({ sql }) => sql.includes('INSERT INTO public.users')), false);
  assert.equal(deps.calls.at(-1).sql, 'ROLLBACK');
});

test('existing admin is preserved and an email collision never promotes an existing user', async () => {
  let bcryptCalled = false;
  const existingAdmin = await provisionInitialAdmin({
    async query() { return { rows: [{ id: 'existing-admin-id' }] }; },
  }, { email: 'admin@example.test', password: validEnv.SBMS_BOOTSTRAP_ADMIN_PASSWORD, fullName: 'Test Administrator' }, {
    async hash() { bcryptCalled = true; throw new Error('must not hash'); },
  });
  assert.equal(existingAdmin, 'existing_admin_preserved');
  assert.equal(bcryptCalled, false);

  const queries = [];
  await assert.rejects(provisionInitialAdmin({
    async query(sql) {
      queries.push(sql);
      return { rows: sql.includes('WHERE role') ? [] : [{ id: 'field-officer-id', role: 'field_officer' }] };
    },
  }, { email: 'admin@example.test', password: validEnv.SBMS_BOOTSTRAP_ADMIN_PASSWORD, fullName: 'Test Administrator' }, {
    async hash() { bcryptCalled = true; return 'unused'; },
  }), /already belongs to an account/);
  assert.equal(queries.some((sql) => sql.includes('INSERT INTO public.users')), false);
  assert.equal(bcryptCalled, false);
});
