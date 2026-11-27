const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'db', 'migrations');
const LEDGER_TABLE = 'public.sbms_schema_migrations';
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

// Two local targets, each pinned to one database name. The test target keeps its existing double
// confirmation. The development target is the database `backend/.env` points at, so a fresh local
// checkout can be built from the same migration chain the test database uses instead of drifting
// behind it. Neither target can name an Azure or production database: the name must match exactly.
const TARGETS = Object.freeze({
  test: Object.freeze({
    key: 'test',
    database: 'sbms_test',
    username: 'sbms_test_runner',
    approval: 'sbms_test',
    confirmationFlag: '--confirm-sbms-test',
    label: 'local test database',
  }),
  dev: Object.freeze({
    key: 'dev',
    database: 'student_beneficiary_system',
    username: null,
    approval: 'student_beneficiary_system',
    confirmationFlag: '--confirm-local-dev',
    label: 'local development database',
  }),
});
const TEST_DATABASE = TARGETS.test;

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
  '20261025_legacy_beneficiaries_baseline.sql',
  '20261031_bursary_certificates.sql',
  '20261111_notifications.sql',
  '20261111_remove_award_verification_gate.sql',
  '20261112_award_annual_restriction.sql',
  '20261113_notifications_dismiss_on_read.sql',
  '20261115_password_reset_tokens.sql',
  '20261115_eligibility_assessments_and_duplicate_resolution.sql',
  '20261119_guardian_accounts.sql',
  '20261122_guardian_student_pipeline.sql',
  '20261123_guardian_eligibility_inputs.sql',
  '20261124_guardian_admission_number.sql',
  '20261126_admin_eligibility_corrections.sql',
  '20261127_auto_approve_cleared_guardian_applications.sql',
]);

const MANUAL_MIGRATIONS = Object.freeze([
  '20261023_retain_primary_accounts.sql',
]);

// Applied on the former guardian-led redesign and intentionally absent from this tree.
// The ledger rows are kept (history is never rewritten) and the SQL remains recoverable
// from commit 80badde, but the runner treats these as retired: never pending and never
// re-applied. Removing objects they created is a separate, reviewed decision.
const RETIRED_MIGRATIONS = Object.freeze([
  '20261116_student_applications.sql',
  '20261116_application_duplicate_cases.sql',
  '20261116_application_submission_guard.sql',
  '20261117_application_closure.sql',
]);

function validateTargetDatabaseUrl(value, target = TEST_DATABASE) {
  if (!value) {
    throw new Error(`Set the ${target.database} connection URL explicitly before migrating.`);
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('The migration database URL must be a valid PostgreSQL URL.'); }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(url.pathname.slice(1));
  const username = decodeURIComponent(url.username);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !LOCAL_DATABASE_HOSTS.has(host)
    || database !== target.database
    || (target.username !== null && username !== target.username)
    || url.search || url.hash
    || url.pathname !== `/${target.database}`) {
    const role = target.username ? ` using ${target.username}` : '';
    throw new Error(`Refusing migration connection: only the local ${target.database} database${role} is allowed.`);
  }
  return value;
}

function parseTarget(args) {
  const requested = args.find((arg) => arg.startsWith('--target='));
  if (!requested) return TEST_DATABASE;
  const key = requested.slice('--target='.length);
  if (!Object.hasOwn(TARGETS, key)) {
    throw new Error(`Unknown migration target: ${key}. Use --target=test or --target=dev.`);
  }
  return TARGETS[key];
}

function readEnvFile() {
  try {
    return require('dotenv').parse(fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8'));
  } catch {
    return {};
  }
}

// The test target must be pointed at explicitly by the test tooling. The development target always
// comes from the application's own .env, because the ambient shell in this workspace inherits the
// test database URL: reading the file directly is what keeps `npm start` and the migration pointed
// at the same database.
function resolveConnectionString(target) {
  if (target.key === 'test') return process.env.SBMS_MIGRATION_DATABASE_URL;
  return readEnvFile().DATABASE_URL;
}

async function createMigrationLedger(client) {
  await client.query(`CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
    name TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

function assertMigrationOwnsItsTransaction(name, sql) {
  if (/^\s*BEGIN\s*;/im.test(sql) || /^\s*COMMIT\s*;/im.test(sql)) {
    throw new Error(`Migration ${name} contains transaction control; runner owns transactions.`);
  }
}

// One migration, one transaction, one ledger row. Exported so the local setup script builds the
// development database with the same rules the test database was built with.
async function applyMigrationFile(client, name) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8');
  assertMigrationOwnsItsTransaction(name, sql);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(`INSERT INTO ${LEDGER_TABLE}(name) VALUES ($1)`, [name]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`Migration failed and was rolled back: ${name}: ${error.message}`, { cause: error });
  }
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
  const migrationTarget = parseTarget(args);
  const confirm = args.includes(migrationTarget.confirmationFlag);
  const confirmBaseline = args.includes('--confirm-schema-baseline');
  const markAppliedArg = args.find((arg) => arg.startsWith('--mark-applied='));
  if (!['status', 'dry-run', 'adopt', 'apply'].includes(command)) {
    throw new Error('Usage: node scripts/migrate.js <status|dry-run|adopt|apply> [--target=test|dev] [confirmation flags]');
  }

  const connectionString = resolveConnectionString(migrationTarget);
  validateTargetDatabaseUrl(connectionString, migrationTarget);
  if (['apply', 'adopt'].includes(command) && !confirm) {
    throw new Error(`${command} requires the explicit ${migrationTarget.confirmationFlag} flag.`);
  }
  if (command === 'adopt' && !confirmBaseline) {
    throw new Error('Schema adoption requires --confirm-schema-baseline after reviewing prior migration history.');
  }
  const approvedByEnv = process.env.SBMS_MIGRATIONS_APPROVED === migrationTarget.approval;
  // The development database is pinned by name to the one `.env` names as expected, so an operator
  // rebuilding their own checkout only needs the explicit target flag. The test database keeps the
  // separate approval variable because it shares a cluster with other local verification tooling.
  const approvedByExpectedName = migrationTarget.key === 'dev'
    && (readEnvFile().SBMS_EXPECTED_DATABASE_NAME || '').trim() === migrationTarget.database;
  if (['apply', 'adopt'].includes(command) && !approvedByEnv && !approvedByExpectedName) {
    throw new Error(`${command} also requires SBMS_MIGRATIONS_APPROVED=${migrationTarget.approval}.`);
  }

  const files = listMigrationFiles();
  const { Client } = require('pg');
  const client = new Client({ connectionString });
  let migrationLockAcquired = false;

  try {
    await client.connect();
    const identity = await client.query('SELECT current_database() AS database, current_user AS username');
    if (identity.rows[0].database !== migrationTarget.database
      || (migrationTarget.username !== null && identity.rows[0].username !== migrationTarget.username)) {
      throw new Error(`Connected database identity did not match the approved local ${migrationTarget.database} target.`);
    }
    if (['adopt', 'apply'].includes(command)) {
      await client.query("SELECT pg_advisory_lock(hashtext('sbms.schema.migrations'))");
      migrationLockAcquired = true;
    }

    const ledgerExists = await client.query(`SELECT to_regclass('${LEDGER_TABLE}') IS NOT NULL AS exists`);
    const applied = ledgerExists.rows[0].exists
      ? await client.query(`SELECT name FROM ${LEDGER_TABLE} ORDER BY name`)
      : { rows: [] };
    const appliedNames = new Set(applied.rows.map((row) => row.name));
    const knownNames = new Set([...files.map((item) => item.name), ...RETIRED_MIGRATIONS]);
    const unknownApplied = [...appliedNames].filter((name) => !knownNames.has(name));
    if (unknownApplied.length) throw new Error(`Migration ledger has unknown entries: ${unknownApplied.join(', ')}.`);
    const retiredApplied = RETIRED_MIGRATIONS.filter((name) => appliedNames.has(name));
    const pending = files.filter((item) => !item.manual && !appliedNames.has(item.name));

    if (command === 'status' || command === 'dry-run') {
      console.log(`Target: ${migrationTarget.database} (${migrationTarget.label})`);
      console.log(`Ledger: ${ledgerExists.rows[0].exists ? 'present' : 'not created'}`);
      console.log(`Applied migrations: ${appliedNames.size}`);
      console.log(`Pending migrations: ${pending.length ? pending.map((item) => item.name).join(', ') : 'none'}`);
      console.log(`Manual-only migrations: ${MANUAL_MIGRATIONS.join(', ')}`);
      console.log(`Retired migrations (ledger-only, files absent): ${retiredApplied.length ? retiredApplied.join(', ') : 'none'}`);
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
        await createMigrationLedger(client);
        for (const name of adoptedNames) {
          await client.query(`INSERT INTO ${LEDGER_TABLE}(name) VALUES ($1)`, [name]);
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
      await applyMigrationFile(client, name);
      console.log(`Applied ${name}`);
    }
    console.log(`Migration run complete. Applied ${pending.length} migration(s).`);
    if (retiredApplied.length) console.log(`Retired migrations left untouched: ${retiredApplied.join(', ')}`);
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

module.exports = {
  listMigrationFiles, parseAdoptionList, parseTarget, validateTargetDatabaseUrl,
  resolveConnectionString, applyMigrationFile, createMigrationLedger,
  MIGRATIONS_DIR, TARGETS, MIGRATION_ORDER, MANUAL_MIGRATIONS, RETIRED_MIGRATIONS, LEDGER_TABLE,
};
