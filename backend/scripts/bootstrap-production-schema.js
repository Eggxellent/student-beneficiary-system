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

async function provisionAdminIfConfigured(client) {
  const email = (process.env.SBMS_BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.SBMS_BOOTSTRAP_ADMIN_PASSWORD || '';
  const fullName = (process.env.SBMS_BOOTSTRAP_ADMIN_NAME || 'SBMS Administrator').trim();

  if (!email && !password) return 'not_configured';
  if (!email || !password) {
    throw new Error('Admin bootstrap requires both SBMS_BOOTSTRAP_ADMIN_EMAIL and SBMS_BOOTSTRAP_ADMIN_PASSWORD.');
  }
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || password.length < 12 || password.length > 72) {
    throw new Error('Admin bootstrap email is invalid or password must be 12–72 characters.');
  }

  const { rows: admins } = await client.query(
    "SELECT id FROM public.users WHERE role = 'admin' LIMIT 1"
  );
  if (admins.length) return 'existing_admin_preserved';

  const { rows: matchingUsers } = await client.query(
    'SELECT id, role FROM public.users WHERE email = $1 LIMIT 1',
    [email]
  );
  if (matchingUsers.length) {
    if (matchingUsers[0].role !== 'admin') {
      throw new Error('Admin bootstrap email already belongs to a non-admin account; no role was changed.');
    }
    return 'existing_admin_preserved';
  }

  const bcrypt = require('bcrypt');
  const passwordHash = await bcrypt.hash(password, 12);
  await client.query(
    "INSERT INTO public.users (full_name, email, password_hash, role, is_active) VALUES ($1, $2, $3, 'admin', TRUE)",
    [fullName, email, passwordHash]
  );
  return 'admin_created';
}

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
      const adminStatus = await provisionAdminIfConfigured(client);
      return { status: 'already_initialized_or_activation_column_repaired', adminStatus };
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
      const adminStatus = await provisionAdminIfConfigured(client);
      return { status: 'users_table_created_for_existing_database', existingCoreTables, adminStatus };
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
    const adminStatus = await provisionAdminIfConfigured(client);
    return { status: 'initialized', appliedMigrations: migrations.length, adminStatus };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('sbms.production.schema.bootstrap'))").catch(() => {});
    client.release();
  }
}

module.exports = { bootstrapIfDatabaseIsEmpty };
