'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { MIGRATION_ORDER } = require('./migrate');

const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
const BOOTSTRAP_LOCK = "SELECT pg_advisory_xact_lock(hashtext('sbms.production.schema.bootstrap'))";

const IDENTITY_AND_OBJECTS_QUERY = `
  SELECT current_database() AS database_name,
         to_regclass('public.users') IS NOT NULL AS users_exists,
         (
           SELECT COUNT(*)::int
           FROM pg_class AS relation
           JOIN pg_namespace AS ns ON ns.oid = relation.relnamespace
           WHERE ns.nspname = 'public'
             AND relation.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')
             AND NOT EXISTS (
               SELECT 1 FROM pg_depend AS dependency
               WHERE dependency.classid = 'pg_class'::regclass
                 AND dependency.objid = relation.oid
                 AND dependency.deptype = 'e'
             )
         )
         + (
           SELECT COUNT(*)::int
           FROM pg_proc AS routine
           JOIN pg_namespace AS ns ON ns.oid = routine.pronamespace
           WHERE ns.nspname = 'public'
             AND NOT EXISTS (
               SELECT 1 FROM pg_depend AS dependency
               WHERE dependency.classid = 'pg_proc'::regclass
                 AND dependency.objid = routine.oid
                 AND dependency.deptype = 'e'
             )
         )
         + (
           SELECT COUNT(*)::int
           FROM pg_type AS custom_type
           JOIN pg_namespace AS ns ON ns.oid = custom_type.typnamespace
           WHERE ns.nspname = 'public'
             AND custom_type.typtype IN ('d', 'e', 'r')
             AND NOT EXISTS (
               SELECT 1 FROM pg_depend AS dependency
               WHERE dependency.classid = 'pg_type'::regclass
                 AND dependency.objid = custom_type.oid
                 AND dependency.deptype = 'e'
             )
         ) AS public_object_count
`;

const VERIFY_SCHEMA_QUERY = `
  SELECT current_database() AS database_name,
         to_regclass('public.users') IS NOT NULL AS users_exists,
         to_regclass('users') = to_regclass('public.users') AS users_resolve_to_public,
         ARRAY(
           SELECT required.column_name
           FROM unnest(ARRAY['id', 'full_name', 'email', 'password_hash', 'role', 'is_active']) AS required(column_name)
           WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.columns AS actual
             WHERE actual.table_schema = 'public'
               AND actual.table_name = 'users'
               AND actual.column_name = required.column_name
           )
         ) AS missing_user_columns
`;

function getBootstrapInputs(env) {
  const expectedDatabaseName = (env.SBMS_EXPECTED_DATABASE_NAME || '').trim();
  const approvedDatabaseName = (env.SBMS_EMPTY_SCHEMA_BOOTSTRAP_APPROVED || '').trim();
  const email = (env.SBMS_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.SBMS_BOOTSTRAP_ADMIN_PASSWORD || '';
  const fullName = (env.SBMS_BOOTSTRAP_ADMIN_NAME || 'SBMS Administrator').trim();

  if (!expectedDatabaseName || approvedDatabaseName !== expectedDatabaseName) {
    throw new Error('Set the explicit empty-schema approval to the expected database name before bootstrapping.');
  }
  if (env.SBMS_INITIALIZE_EMPTY_DATABASE !== 'true') {
    throw new Error('Empty database initialization requires SBMS_INITIALIZE_EMPTY_DATABASE=true.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || Buffer.byteLength(password, 'utf8') < 12
      || Buffer.byteLength(password, 'utf8') > 72
      || fullName.length < 2
      || fullName.length > 255) {
    throw new Error('Valid initial administrator name, email, and 12–72-byte password are required.');
  }
  return { expectedDatabaseName, email, password, fullName };
}

async function provisionInitialAdmin(client, { email, password, fullName }, bcrypt) {
  const admins = await client.query("SELECT id FROM public.users WHERE role = 'admin' LIMIT 1");
  if (admins.rows.length) return 'existing_admin_preserved';

  const matches = await client.query('SELECT id, role FROM public.users WHERE email = $1 LIMIT 1', [email]);
  if (matches.rows.length) {
    throw new Error('The requested administrator email already belongs to an account; no account was changed.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    "INSERT INTO public.users (full_name, email, password_hash, role, is_active) VALUES ($1, $2, $3, 'admin', TRUE)",
    [fullName, email, passwordHash],
  );
  return 'admin_created';
}

async function bootstrapIfDatabaseIsEmpty({
  dbPool,
  env = process.env,
  fsImpl = fs,
  bcryptImpl = require('bcrypt'),
} = {}) {
  const inputs = getBootstrapInputs(env);
  const activePool = dbPool || require('../src/config/db');
  const client = await activePool.connect();
  let transactionOpen = false;

  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query(BOOTSTRAP_LOCK);

    const identity = await client.query(IDENTITY_AND_OBJECTS_QUERY);
    const state = identity.rows[0];
    if (!state || state.database_name !== inputs.expectedDatabaseName) {
      throw new Error('Connected database identity does not match the approved target.');
    }
    if (state.public_object_count !== 0 || state.users_exists) {
      throw new Error('Refusing automatic bootstrap: the public schema is not empty; review it without applying this initializer.');
    }

    await client.query('SET LOCAL search_path TO public');
    await client.query(fsImpl.readFileSync(schemaPath, 'utf8'));
    for (const name of MIGRATION_ORDER) {
      const sql = fsImpl.readFileSync(path.join(migrationsDir, name), 'utf8');
      if (/^\s*(BEGIN|COMMIT)\s*;/im.test(sql)) {
        throw new Error(`Migration ${name} contains transaction control outside the bootstrap runner.`);
      }
      await client.query(sql);
    }

    await client.query(`
      CREATE TABLE public.sbms_schema_migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    for (const name of MIGRATION_ORDER) {
      await client.query('INSERT INTO public.sbms_schema_migrations(name) VALUES ($1)', [name]);
    }

    const verification = await client.query(VERIFY_SCHEMA_QUERY);
    const verified = verification.rows[0];
    if (!verified
        || verified.database_name !== inputs.expectedDatabaseName
        || verified.users_exists !== true
        || verified.users_resolve_to_public !== true
        || !Array.isArray(verified.missing_user_columns)
        || verified.missing_user_columns.length !== 0) {
      throw new Error('Schema verification failed; the transaction will be rolled back.');
    }

    const adminStatus = await provisionInitialAdmin(client, inputs, bcryptImpl);
    await client.query('COMMIT');
    transactionOpen = false;
    return { status: 'initialized', appliedMigrations: MIGRATION_ORDER.length, adminStatus };
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  const runtimePool = require('../src/config/db');
  bootstrapIfDatabaseIsEmpty({ dbPool: runtimePool })
    .then(({ status, appliedMigrations, adminStatus }) => {
      console.log(`SBMS schema bootstrap completed: ${status}; migrations=${appliedMigrations}; admin=${adminStatus}.`);
      console.log('Remove the one-time bootstrap approval and administrator password environment values.');
    })
    .catch(() => {
      console.error('SBMS schema bootstrap failed safely; no credentials or database error details were logged.');
      process.exitCode = 1;
    })
    .finally(() => runtimePool.end());
}

module.exports = {
  bootstrapIfDatabaseIsEmpty,
  getBootstrapInputs,
  provisionInitialAdmin,
  IDENTITY_AND_OBJECTS_QUERY,
  VERIFY_SCHEMA_QUERY,
};
