require('dotenv').config();
const { Pool } = require('pg');

const CONFIRMATION = '--confirm-reset-synthetic-kenyan-data';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function assertLocalDevelopmentDatabase() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (value will not be printed).');
  const url = new URL(process.env.DATABASE_URL);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase()) || /prod|production/i.test(url.pathname)) {
    throw new Error('Refusing to reset data outside a local development/test database.');
  }
  if (process.env.SBMS_ALLOW_LOCAL_SYNTHETIC_SEED !== 'YES' || !process.argv.includes(CONFIRMATION)) {
    throw new Error(`To delete only marked synthetic rows, set SBMS_ALLOW_LOCAL_SYNTHETIC_SEED=YES and pass ${CONFIRMATION}.`);
  }
}

async function main() {
  assertLocalDevelopmentDatabase();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const students = await client.query(
      `SELECT id FROM students
       WHERE is_synthetic = TRUE AND qr_token LIKE 'SBMS-SYNTHETIC-KE-20261019-%'`
    );
    const ids = students.rows.map((row) => row.id);
    if (ids.length) {
      await client.query('DELETE FROM duplicate_flags WHERE student_id = ANY($1::uuid[]) OR matched_student_id = ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM disbursements WHERE student_id = ANY($1::uuid[])', [ids]);
      await client.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [ids]);
    }
    await client.query(
      `DELETE FROM audit_logs
       WHERE action = 'SEED_SYNTHETIC_KENYAN_TEST_DATA'
         AND details->>'seed_id' = 'sbms-kenyan-synthetic-v1'`
    );
    await client.query('COMMIT');
    console.log(`Removed ${ids.length} marked synthetic students and their linked review flags/disbursements. Other records were left untouched.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

main().catch((error) => { console.error(`Synthetic reset failed: ${error.message}`); process.exitCode = 1; }).finally(() => pool.end());
