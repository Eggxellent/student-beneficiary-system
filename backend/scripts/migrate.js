const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
const TEST_DATABASE = Object.freeze({ name: 'sbms_test', user: 'sbms_test_runner' });

// Explicit dependency order. The primary-account policy migration is intentionally
// excluded: it changes existing user activation state and requires a separate decision.
const MIGRATION_ORDER = Object.freeze([
  '20261019_synthetic_student_marker.sql',
  '20261019_field_officer_registration.sql',
  '20261019_standardize_student_records.sql',
  '20261019_limit_synthetic_schools.sql',
  '20261019_admin_field_officer_roles.sql',
  '20261019_duplicate_review_workflow.sql',
  '20261019_enforce_supported_schools.sql',
  '20261019_remove_duplicate_case_assignment.sql',
  '20261022_ml_duplicate_provenance.sql',
  '20261023_bursary_award_reconciliation.sql',
  '20261024_add_user_activation_flag.sql',
]);

const MANUAL_MIGRATIONS = Object.freeze([
  '20261023_retain_primary_accounts.sql',
]);

function validateTargetDatabaseUrl(value) {
  if (!value) throw new Error('Set SBMS_MIGRATION_DATABASE_URL to the approved local sbms_test URL.');
  let url;
  try { url = new URL(value); } catch { throw new Error('SBMS_MIGRATION_DATABASE_URL must be a valid PostgreSQL URL.'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '::1'].includes(host)
    || database !== TEST_DATABASE.name
    || decodeURIComponent(url.username) !== TEST_DATABASE.user
    || url.search || url.hash
    || url.pathname !== `/${TEST_DATABASE.name}`) {
    throw new Error('Refusing migration connection: only the local sbms_test database using sbms_test_runner is allowed.');
  }
  return url;
}

function listMigrationFiles(directory = MIGRATIONS_DIR) {
  const discovered = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.sql') && !name.endsWith('.down.sql'));
  const ordered = [...MIGRATION_ORDER, ...MANUAL_MIGRATIONS];
  const unexpected = discovered.filter((name) => !ordered.includes(name));
  const missing = ordered.filter((name) => !discovered.includes(name));
  if (unexpected.length || missing.length) {
    throw new Error(`Migration inventory mismatch. Unlisted: ${unexpected.join(', ') || 'none'}; missing: ${missing.join(', ') || 'none'}.`);
  }
  return [
    ...MIGRATION_ORDER.map((name) => ({ name, manual: false })),
    ...MANUAL_MIGRATIONS.map((name) => ({ name, manual: true })),
  ];
}

function parseAdoptionList(value, files = listMigrationFiles()) {
  if (value === 'none') return [];
  if (!value) throw new Error('Schema adoption requires --mark-applied=<known migration names|none>.');
  const names = value.split(',').map((name) => name.trim()).filter(Boolean);
  const knownNames = new Set(files.map((item) => item.name));
  if (!names.length || new Set(names).size !== names.length || names.some((name) => !knownNames.has(name))) {
    throw new Error('Schema adoption contains an empty, repeated, or unknown migration name.');
  }
  return names;
}

async function run() {
  const command = process.argv[2];
  const args = process.argv.slice(3);
  const confirm = args.includes('--confirm-sbms-test');
  const confirmBaseline = args.includes('--confirm-schema-baseline');
  const markAppliedArg = args.find((arg) => arg.startsWith('--mark-applied='));
  if (!['status', 'dry-run', 'adopt', 'apply'].includes(command)) {
    throw new Error('Usage: node scripts/migrate.js <status|dry-run|adopt|apply> [confirmation flags]');
  }
  if (['apply', 'adopt'].includes(command) && !confirm) {
    throw new Error(`${command} requires the explicit --confirm-sbms-test flag.`);
  }
  if (command === 'adopt' && !confirmBaseline) {
    throw new Error('Schema adoption requires --confirm-schema-baseline after reviewing prior migration history.');
  }
  if (['apply', 'adopt'].includes(command) && process.env.SBMS_MIGRATIONS_APPROVED !== 'sbms_test') {
    throw new Error(`${command} also requires SBMS_MIGRATIONS_APPROVED=sbms_test.`);
  }

  const connectionString = process.env.SBMS_MIGRATION_DATABASE_URL;
  validateTargetDatabaseUrl(connectionString);
  const files = listMigrationFiles();
  const { Client } = require('pg');
  const client = new Client({ connectionString });
  let migrationLockAcquired = false;

  try {
    await client.connect();
    const target = await client.query('SELECT current_database() AS database, current_user AS username');
    if (target.rows[0].database !== TEST_DATABASE.name || target.rows[0].username !== TEST_DATABASE.user) {
      throw new Error('Connected database identity did not match the approved local sbms_test target.');
    }
    if (['adopt', 'apply'].includes(command)) {
      await client.query("SELECT pg_advisory_lock(hashtext('sbms.schema.migrations'))");
      migrationLockAcquired = true;
    }

    const ledgerExists = await client.query("SELECT to_regclass('public.sbms_schema_migrations') IS NOT NULL AS exists");
    const applied = ledgerExists.rows[0].exists
      ? await client.query('SELECT name FROM public.sbms_schema_migrations ORDER BY name')
      : { rows: [] };
    const appliedNames = new Set(applied.rows.map((row) => row.name));
    const knownNames = new Set(files.map((item) => item.name));
    const unknownApplied = [...appliedNames].filter((name) => !knownNames.has(name));
    if (unknownApplied.length) throw new Error(`Migration ledger has unknown entries: ${unknownApplied.join(', ')}.`);
    const pending = files.filter((item) => !item.manual && !appliedNames.has(item.name));

    if (command === 'status' || command === 'dry-run') {
      console.log(`Target: ${TEST_DATABASE.name} (local test database)`);
      console.log(`Ledger: ${ledgerExists.rows[0].exists ? 'present' : 'not created'}`);
      console.log(`Applied migrations: ${appliedNames.size}`);
      console.log(`Pending migrations: ${pending.length ? pending.map((item) => item.name).join(', ') : 'none'}`);
      console.log(`Manual-only migrations: ${MANUAL_MIGRATIONS.join(', ')}`);
      if (!ledgerExists.rows[0].exists) console.log('Ledger absent. Application is blocked until schema history is explicitly adopted.');
      if (command === 'dry-run') console.log('Dry run only; no schema changes were made.');
      return;
    }

    if (command === 'apply' && !ledgerExists.rows[0].exists) {
      throw new Error('No migration ledger exists. Review the schema and migration history, then use adopt before applying.');
    }

    // Check the unchanged legacy schema prerequisites before adoption or migration.
    const prerequisites = await client.query(`
      SELECT to_regclass('public.users') IS NOT NULL AS users,
             to_regclass('public.students') IS NOT NULL AS students,
             to_regclass('public.audit_logs') IS NOT NULL AS audit_logs,
             to_regclass('public.duplicate_flags') IS NOT NULL AS duplicate_flags,
             to_regclass('public.disbursements') IS NOT NULL AS disbursements,
             EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='students' AND column_name='birth_certificate_number') AS birth_certificate_number
    `);
    if (Object.values(prerequisites.rows[0]).some((present) => !present)) {
      throw new Error('Core schema prerequisites are incomplete; no migration was started. Reconcile the base schema manually first.');
    }

    if (command === 'adopt') {
      if (ledgerExists.rows[0].exists) throw new Error('A migration ledger already exists; adoption is only for an untracked schema.');
      const adoptedNames = parseAdoptionList(markAppliedArg?.slice('--mark-applied='.length), files);
      try {
        await client.query('BEGIN');
        await client.query(`CREATE TABLE public.sbms_schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`);
        for (const name of adoptedNames) {
          await client.query('INSERT INTO public.sbms_schema_migrations(name) VALUES ($1)', [name]);
        }
        await client.query('COMMIT');
        console.log(`Ledger initialized; adopted as already applied: ${adoptedNames.length ? adoptedNames.join(', ') : 'none'}`);
        console.log('No migration SQL was executed.');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ledger adoption failed and was rolled back: ${error.message}`, { cause: error });
      }
      return;
    }

    for (const { name } of pending) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
      if (/^\s*BEGIN\s*;/im.test(sql) || /^\s*COMMIT\s*;/im.test(sql)) {
        throw new Error(`Migration ${name} contains transaction control; runner owns transactions.`);
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO public.sbms_schema_migrations(name) VALUES ($1)', [name]);
        await client.query('COMMIT');
        console.log(`Applied ${name}`);
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration failed and was rolled back: ${name}: ${error.message}`, { cause: error });
      }
    }
    console.log(`Migration run complete. Applied ${pending.length} migration(s).`);
    if (MANUAL_MIGRATIONS.length) console.log(`Not applied (manual decision required): ${MANUAL_MIGRATIONS.join(', ')}`);
  } finally {
    if (migrationLockAcquired) {
      await client.query("SELECT pg_advisory_unlock(hashtext('sbms.schema.migrations'))").catch(() => {});
    }
    await client.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { listMigrationFiles, parseAdoptionList, validateTargetDatabaseUrl, MIGRATION_ORDER, MANUAL_MIGRATIONS };
