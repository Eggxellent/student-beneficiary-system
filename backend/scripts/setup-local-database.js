// Rebuild the local development database from the same base schema and migration chain the test
// database is built from. It exists because `scripts/migrate.js` deliberately refuses to touch any
// database it does not know by name: before this script the development database in `backend/.env`
// could not be brought up to date at all, so `npm start` served a legacy schema.
//
// What it preserves: the `users` rows. Their bcrypt password hashes are portable, so the accounts
// that could sign in before the rebuild can still sign in afterwards. Everything else is discarded.
//
// Safety: refuses unless every one of these holds.
//   * SBMS_ALLOW_LOCAL_DATABASE_SETUP=YES
//   * --confirm-local-database-setup on the command line
//   * DATABASE_URL (read from backend/.env) is loopback and names student_beneficiary_system
//   * SBMS_EXPECTED_DATABASE_NAME, when set, names the same database
//   * NODE_ENV is not production
'use strict';

const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '..', '.env');
const SCHEMA_PATH = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const TARGET_DATABASE = 'student_beneficiary_system';
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$/;

function fail(message) {
  throw new Error(message);
}

function loadEnvironment() {
  // Parsed from the file instead of `dotenv.config`, which never overrides an already exported
  // variable. This workspace exports the test database URL, so trusting the ambient value here
  // would rebuild the test database instead of the development one.
  let env = {};
  try {
    env = require('dotenv').parse(fs.readFileSync(ENV_PATH, 'utf8'));
  } catch {
    fail('backend/.env could not be read.');
  }
  const nodeEnv = env.NODE_ENV || process.env.NODE_ENV;
  if (nodeEnv === 'production') {
    fail('Refusing to rebuild a database with NODE_ENV=production.');
  }
  if (process.env.SBMS_ALLOW_LOCAL_DATABASE_SETUP !== 'YES') {
    fail('Set SBMS_ALLOW_LOCAL_DATABASE_SETUP=YES to confirm the rebuild.');
  }
  if (!process.argv.includes('--confirm-local-database-setup')) {
    fail('Pass --confirm-local-database-setup to confirm the rebuild.');
  }
  const raw = env.DATABASE_URL;
  if (!raw) fail('DATABASE_URL must be set in backend/.env.');
  const url = new URL(raw);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !LOCAL_HOSTS.has(host)
    || database !== TARGET_DATABASE
    || url.search || url.hash
    || url.pathname !== `/${TARGET_DATABASE}`) {
    fail(`Refusing to rebuild: DATABASE_URL must be the local ${TARGET_DATABASE} database.`);
  }
  const expected = (env.SBMS_EXPECTED_DATABASE_NAME || '').trim();
  if (expected && expected !== TARGET_DATABASE) {
    fail(`SBMS_EXPECTED_DATABASE_NAME is ${expected}, which does not match ${TARGET_DATABASE}.`);
  }
  return url;
}

function maintenanceUrl(url) {
  const copy = new URL(url.toString());
  copy.pathname = '/postgres';
  return copy.toString();
}

async function readExistingUsers(client) {
  const table = await client.query("SELECT to_regclass('public.users') IS NOT NULL AS present");
  if (!table.rows[0].present) return [];
  const { rows } = await client.query('SELECT * FROM public.users ORDER BY created_at NULLS FIRST, email');
  return rows;
}


// Only the columns the rebuilt schema still has are copied back. Legacy columns that the current
// schema does not have are dropped, and new columns such as `national_id` take their defaults.
async function restoreUsers(client, users) {
  if (!users.length) return 0;
  const { rows: columns } = await client.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'`,
  );
  const available = new Set(columns.map((row) => row.column_name));
  const skipped = new Set();
  let restored = 0;
  for (const user of users) {
    const names = Object.keys(user).filter((name) => available.has(name));
    for (const name of Object.keys(user)) if (!available.has(name)) skipped.add(name);
    if (!names.includes('email')) continue;
    const passwordHash = user.password_hash;
    if (typeof passwordHash !== 'string' || !BCRYPT_HASH_PATTERN.test(passwordHash)) {
      // A row that cannot authenticate is not worth copying; it would also point at a password
      // format this application no longer verifies.
      continue;
    }
    const placeholders = names.map((_, index) => `$${index + 1}`).join(', ');
    const quoted = names.map((name) => `"${name}"`).join(', ');
    await client.query(
      `INSERT INTO public.users (${quoted}) VALUES (${placeholders}) ON CONFLICT (email) DO NOTHING`,
      names.map((name) => user[name]),
    );
    restored += 1;
  }
  if (skipped.size) console.log(`Legacy user columns not carried over: ${[...skipped].sort().join(', ')}`);
  return restored;
}

async function main() {
  const url = loadEnvironment();
  const { Client } = require('pg');
  const { listMigrationFiles, createMigrationLedger, applyMigrationFile, MIGRATION_ORDER, LEDGER_TABLE } =
    require('./migrate');
  const { REQUIRED_TABLES } = require('../src/services/databaseReadiness');

  const files = listMigrationFiles();
  const planned = files.filter((item) => MIGRATION_ORDER.includes(item.name));
  if (planned.length !== MIGRATION_ORDER.length) {
    fail('Migration inventory is incomplete; refusing to rebuild from a partial chain.');
  }

  const admin = new Client({ connectionString: maintenanceUrl(url) });
  await admin.connect();
  let users = [];
  try {
    const targetClient = new Client({ connectionString: url.toString() });
    await targetClient.connect();
    try {
      users = await readExistingUsers(targetClient);
    } finally {
      await targetClient.end();
    }
    console.log(`Preserving ${users.length} existing user account(s).`);

    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [TARGET_DATABASE],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${TARGET_DATABASE}"`);
    await admin.query(`CREATE DATABASE "${TARGET_DATABASE}"`);
    console.log(`Recreated database ${TARGET_DATABASE}.`);
  } finally {
    await admin.end();
  }


  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', ['sbms.schema.migrations']);
    await client.query(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    console.log('Applied src/db/schema.sql.');
    await createMigrationLedger(client);
    for (const name of MIGRATION_ORDER) {
      await applyMigrationFile(client, name);
    }
    console.log(`Applied ${MIGRATION_ORDER.length} migrations.`);

    const restored = await restoreUsers(client, users);
    console.log(`Restored ${restored} user account(s).`);

    const ledger = await client.query(`SELECT count(*)::int AS count FROM ${LEDGER_TABLE}`);
    const tables = await client.query(
      `SELECT array_agg(name ORDER BY name) AS present FROM unnest($1::text[]) AS expected(name)
        WHERE to_regclass(format('public.%I', name)) IS NOT NULL`,
      [REQUIRED_TABLES],
    );
    const missing = REQUIRED_TABLES.filter((name) => !tables.rows[0].present.includes(name));
    if (missing.length) fail(`Required tables missing after rebuild: ${missing.join(', ')}`);
    const eligibility = await client.query(
      `SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'guardian_applications'
          AND column_name IN ('fee_balance', 'vulnerability_status', 'siblings_in_school', 'prior_bursary_history')`,
    );
    if (eligibility.rows[0].count !== 4) {
      fail('Guardian eligibility columns are missing after rebuild.');
    }
    const authColumns = await client.query(
      `SELECT count(*)::int AS count FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users'
          AND column_name IN ('national_id', 'relationship_to_student')`,
    );
    if (authColumns.rows[0].count !== 2) {
      fail('The users table is missing the guardian profile columns after rebuild.');
    }
    const counts = await client.query(
      `SELECT 'users' AS name, count(*)::int AS count FROM users
        UNION ALL SELECT 'students', count(*)::int FROM students
        UNION ALL SELECT 'guardian_applications', count(*)::int FROM guardian_applications`,
    );
    console.log(`Migration ledger entries: ${ledger.rows[0].count}`);
    for (const row of counts.rows) console.log(`  ${row.name}: ${row.count}`);
    console.log(`Database ${TARGET_DATABASE} is ready.`);
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['sbms.schema.migrations']).catch(() => {});
    await client.end();
  }
}

main().catch((error) => {
  console.error(`Local database setup failed: ${error.message}`);
  process.exitCode = 1;
});
