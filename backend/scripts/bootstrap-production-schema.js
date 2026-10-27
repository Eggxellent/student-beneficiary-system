const fs = require('node:fs');
const path = require('node:path');
const pool = require('../src/config/db');

const schemaPath = path.join(__dirname, '..', 'src', 'db', 'schema.sql');
const migrationsDir = path.join(__dirname, '..', 'src', 'db', 'migrations');
const migrations = [
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
];

// Only initialize a genuinely empty SBMS database. Never attempt to repair a
// partially-created production schema automatically or rewrite existing records.
async function bootstrapIfDatabaseIsEmpty() {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('sbms.production.schema.bootstrap'))");
    const inventory = await client.query(`
      SELECT
        to_regclass('public.users') AS users,
        to_regclass('public.students') AS students,
        to_regclass('public.duplicate_flags') AS duplicate_flags,
        to_regclass('public.disbursements') AS disbursements,
        to_regclass('public.audit_logs') AS audit_logs,
        to_regclass('public.reports') AS reports,
        to_regclass('public.beneficiaries') AS beneficiaries
    `);
    const current = inventory.rows[0];
    if (current.users) {
      await client.query(
        'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE'
      );
      return { status: 'already_initialized_or_activation_column_repaired' };
    }

    const existingCoreTables = Object.entries(current)
      .filter(([name, value]) => name !== 'users' && value !== null)
      .map(([name]) => name);
    if (existingCoreTables.length) {
      // Repair the specific login blocker without altering existing tables or data.
      await client.query(`
        CREATE TABLE public.users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          full_name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role VARCHAR(50) NOT NULL DEFAULT 'field_officer',
          is_active BOOLEAN NOT NULL DEFAULT TRUE,
          CONSTRAINT users_role_supported_check CHECK (role IN ('admin', 'field_officer')),
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      return { status: 'users_table_created_for_existing_database', existingCoreTables };
    }

    await client.query('BEGIN');
    try {
      await client.query(fs.readFileSync(schemaPath, 'utf8'));
      for (const name of migrations) {
        const sql = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
        await client.query(sql);
      }
      await client.query(`
        CREATE TABLE IF NOT EXISTS public.sbms_schema_migrations (
          name TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      for (const name of migrations) {
        await client.query(
          'INSERT INTO public.sbms_schema_migrations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
          [name]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const verify = await client.query(`
      SELECT
        to_regclass('public.users') IS NOT NULL AS users,
        to_regclass('public.students') IS NOT NULL AS students,
        to_regclass('public.duplicate_flags') IS NOT NULL AS duplicate_flags,
        to_regclass('public.disbursements') IS NOT NULL AS disbursements,
        to_regclass('public.bursary_awards') IS NOT NULL AS bursary_awards,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'is_active'
        ) AS users_has_is_active
    `);
    if (Object.values(verify.rows[0]).some((value) => value !== true)) {
      throw new Error('Schema bootstrap verification failed; refusing to start the API.');
    }
    return { status: 'initialized', appliedMigrations: migrations.length };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('sbms.production.schema.bootstrap'))").catch(() => {});
    client.release();
  }
}

module.exports = { bootstrapIfDatabaseIsEmpty };
