require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const approvedSchools = ['Nairobi School', 'Alliance High', 'Bishop Gatimu', 'Loreto Limuru', 'Maranda'];
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query(
      `SELECT id FROM students
       WHERE school_code IS NOT NULL AND NOT (school_code = ANY($1::text[]))
       FOR UPDATE`,
      [approvedSchools],
    );
    const studentIds = locked.rows.map(({ id }) => id);
    if (studentIds.length) {
      const flags = await client.query(
        `SELECT DISTINCT id FROM duplicate_flags
         WHERE student_id = ANY($1::uuid[]) OR matched_student_id = ANY($1::uuid[])`,
        [studentIds],
      );
      const events = flags.rowCount
        ? await client.query('SELECT count(*)::int AS count FROM duplicate_review_events WHERE duplicate_flag_id = ANY($1::uuid[])', [flags.rows.map(({ id }) => id)])
        : { rows: [{ count: 0 }] };
      const disbursements = await client.query(
        'SELECT count(*)::int AS count FROM disbursements WHERE student_id = ANY($1::uuid[])',
        [studentIds],
      );
      const deleted = await client.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]);
      const schoolConstraintMigration = fs.readFileSync(
        path.join(__dirname, '../src/db/migrations/20261019_enforce_supported_schools.sql'),
        'utf8',
      );
      await client.query(schoolConstraintMigration);
      const verification = await client.query(
        `SELECT count(*) FILTER (WHERE school_code IS NOT NULL AND NOT (school_code = ANY($1::text[])))::int AS unsupported,
                count(*) FILTER (WHERE school_code IS NULL)::int AS missing_school,
                count(*) FILTER (WHERE school_code = ANY($1::text[]))::int AS approved
         FROM students`,
        [approvedSchools],
      );
      await client.query('COMMIT');
      console.log(JSON.stringify({
        deletedStudents: deleted.rowCount,
        cascadedDuplicateCases: flags.rowCount,
        cascadedReviewEvents: events.rows[0].count,
        cascadedDisbursements: disbursements.rows[0].count,
        remainingStudents: verification.rows[0],
      }));
    } else {
      const schoolConstraintMigration = fs.readFileSync(
        path.join(__dirname, '../src/db/migrations/20261019_enforce_supported_schools.sql'),
        'utf8',
      );
      await client.query(schoolConstraintMigration);
      const verification = await client.query(
        `SELECT count(*) FILTER (WHERE school_code IS NOT NULL AND NOT (school_code = ANY($1::text[])))::int AS unsupported,
                count(*) FILTER (WHERE school_code IS NULL)::int AS missing_school,
                count(*) FILTER (WHERE school_code = ANY($1::text[]))::int AS approved
         FROM students`,
        [approvedSchools],
      );
      await client.query('COMMIT');
      console.log(JSON.stringify({ deletedStudents: 0, cascadedDuplicateCases: 0, cascadedReviewEvents: 0, cascadedDisbursements: 0, remainingStudents: verification.rows[0] }));
    }
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
