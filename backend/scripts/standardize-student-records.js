require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const migration = fs.readFileSync(
      path.join(__dirname, '../src/db/migrations/20261019_standardize_student_records.sql'),
      'utf8',
    );
    await client.query(migration);
    const verification = await client.query(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE full_name <> regexp_replace(btrim(full_name), '\\s+', ' ', 'g'))::int AS nonstandard_names,
              count(*) FILTER (WHERE primary_phone IS NOT NULL AND primary_phone !~ '^\\+254[17][0-9]{8}$')::int AS nonstandard_phones
       FROM students`,
    );
    await client.query('COMMIT');
    console.log(JSON.stringify(verification.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
