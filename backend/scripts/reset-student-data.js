/**
 * Local development/test reset: remove every student registration record and everything that hangs
 * off it, so the next guardian submission starts from a clean database.
 *
 * What is removed (and only this): students, guardian applications, eligibility assessments,
 * duplicate flags/resolutions/review events, bursary awards and certificates, disbursements, legacy
 * student_applications rows, the legacy beneficiaries table, and any other table that references
 * those rows by foreign key. The dependent set is discovered from the live foreign-key graph instead
 * of being hard-coded, so a table added by a later migration cannot leave orphans behind.
 *
 * What is kept: user accounts (guardians, officers, admins), audit logs, reports, notifications and
 * every configuration table. Accounts are login identities, not student registrations.
 *
 * Safety: refuses to run outside a local database, refuses production-looking database names, and
 * requires both SBMS_ALLOW_LOCAL_STUDENT_RESET=YES and an explicit confirmation flag. The resolved
 * database name, role, host and port are printed before anything is deleted.
 *
 * Usage (from backend/):
 *   $env:SBMS_ALLOW_LOCAL_STUDENT_RESET='YES'; node scripts/reset-student-data.js --confirm-reset-students
 */
require('dotenv').config();
const { Pool } = require('pg');

const CONFIRMATION = '--confirm-reset-students';
const ROOT_TABLES = ['students', 'guardian_applications', 'eligibility_assessments', 'duplicate_flags', 'beneficiaries'];
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function resolveTarget() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (value will not be printed).');
  const url = new URL(process.env.DATABASE_URL);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to reset ${database}: ${host} is not a local database host.`);
  }
  if (/prod|production|azure|live/i.test(database)) {
    throw new Error(`Refusing to reset "${database}": the name looks like production or live data.`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset while NODE_ENV=production.');
  }
  const expected = process.env.SBMS_EXPECTED_DATABASE_NAME;
  if (expected && expected !== database) {
    throw new Error(`Refusing to reset "${database}": SBMS_EXPECTED_DATABASE_NAME is "${expected}".`);
  }
  if (process.env.SBMS_ALLOW_LOCAL_STUDENT_RESET !== 'YES' || !process.argv.includes(CONFIRMATION)) {
    throw new Error(
      `To delete student records, set SBMS_ALLOW_LOCAL_STUDENT_RESET=YES and pass ${CONFIRMATION}.`,
    );
  }
  return { database, host };
}

// Every table that (transitively) references one of the roots. Only child rows are followed, so
// users - which the roots point at, not the other way round - is never part of the set.
async function dependentTables(client, existingTables) {
  const { rows } = await client.query(
    `SELECT tc.table_name AS child, ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`,
  );
  const set = new Set(ROOT_TABLES.filter((name) => existingTables.has(name)));
  let added = true;
  while (added) {
    added = false;
    for (const { child, parent } of rows) {
      if (set.has(parent) && !set.has(child) && existingTables.has(child)) {
        set.add(child);
        added = true;
      }
    }
  }
  return [...set].sort();
}

async function main() {
  const target = resolveTarget();
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    const identity = (
      await client.query(
        `SELECT current_database() AS db, current_user AS usr,
                inet_server_addr()::text AS host, inet_server_port() AS port`,
      )
    ).rows[0];
    if (identity.db !== target.database) {
      throw new Error(`Connected to "${identity.db}" but DATABASE_URL names "${target.database}". Aborting.`);
    }

    const { rows: tableRows } = await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const existingTables = new Set(tableRows.map((row) => row.table_name));
    const tables = await dependentTables(client, existingTables);

    const countsBefore = {};
    for (const table of tables) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS total FROM "${table}"`);
      countsBefore[table] = rows[0].total;
    }

    console.log(`Target: database=${identity.db} role=${identity.usr} host=${identity.host} port=${identity.port}`);
    console.log(`Removing from: ${tables.map((table) => `${table}(${countsBefore[table]})`).join(', ')}`);

    await client.query('BEGIN');
    try {
      await client.query(`TRUNCATE TABLE ${tables.map((table) => `"${table}"`).join(', ')} RESTART IDENTITY CASCADE`);
      // Application references start at APP-<year>-00001 again on a fresh database.
      const sequence = await client.query("SELECT to_regclass('public.guardian_application_reference_seq') IS NOT NULL AS exists");
      if (sequence.rows[0].exists) {
        await client.query('ALTER SEQUENCE guardian_application_reference_seq RESTART WITH 1');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const remaining = [];
    for (const table of tables) {
      const { rows } = await client.query(`SELECT COUNT(*)::int AS total FROM "${table}"`);
      if (rows[0].total !== 0) remaining.push(`${table}=${rows[0].total}`);
    }
    if (remaining.length) throw new Error(`Reset incomplete, rows remain: ${remaining.join(', ')}`);

    console.log(`Cleared ${tables.length} tables. Row counts verified at 0.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Student reset failed: ${error.message}`);
  process.exitCode = 1;
});
