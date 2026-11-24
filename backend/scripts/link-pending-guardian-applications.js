require('dotenv').config();
const pool = require('../src/config/db');
const { linkGuardianApplicationStudent } = require('../src/services/guardianApplicationLink');

// Repairs guardian applications that were stored before the application -> student pipeline
// existed. Those rows have no student_id, so duplicate screening, eligibility and every staff
// screen never saw them. Each application is linked through the same service a new submission
// uses, so the resulting student, duplicate flags and assessment are identical to a fresh
// registration. Nothing is deleted or rewritten beyond student_id and the linked audit entry.
//
// Dry run by default; writes require both an explicit flag and --apply.

const APPLY = process.argv.includes('--apply');
const CONFIRMATION_ENV = 'SBMS_ALLOW_GUARDIAN_BACKFILL';

function databaseTarget() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (value will not be printed).');
  const url = new URL(process.env.DATABASE_URL);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || /prod|production/i.test(url.pathname)) {
    throw new Error('Refusing to run against a non-local or production-looking database.');
  }
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function describe(application) {
  return [
    application.reference,
    application.student_full_name,
    application.school_name,
    application.status,
  ].join(' | ');
}

async function pendingApplications() {
  const { rows } = await pool.query(
    `SELECT * FROM guardian_applications
      WHERE student_id IS NULL AND status <> 'rejected'
      ORDER BY created_at ASC, id ASC`,
  );
  return rows;
}

async function link(application) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Same serialisation a submission uses, so a guardian cannot be linked twice concurrently.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `sbms.guardian.application.${application.user_id}`,
    ]);
    const { rows } = await client.query(
      'SELECT * FROM guardian_applications WHERE id = $1 FOR UPDATE',
      [application.id],
    );
    const current = rows[0];
    if (!current || current.student_id) {
      await client.query('ROLLBACK');
      return null;
    }

    const linkage = await linkGuardianApplicationStudent({
      client,
      application: current,
      actorId: current.user_id,
    });
    await client.query('COMMIT');
    return linkage;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const databaseName = databaseTarget();
  if (APPLY && process.env[CONFIRMATION_ENV] !== 'YES') {
    throw new Error(`To write links, set ${CONFIRMATION_ENV}=YES and pass --apply.`);
  }

  const applications = await pendingApplications();
  console.log(`Database: ${databaseName}`);
  console.log(`Unlinked guardian applications (not rejected): ${applications.length}`);
  for (const application of applications) console.log(`  ${describe(application)}`);

  if (!applications.length) {
    console.log('Nothing to link.');
    return;
  }

  if (!APPLY) {
    console.log('Dry run only. Review the target, then set the confirmation variable and pass --apply.');
    return;
  }

  const linked = [];
  const failed = [];
  for (const application of applications) {
    try {
      const linkage = await link(application);
      if (linkage) {
        linked.push({
          reference: application.reference,
          student_id: linkage.student.id,
          flags: linkage.flags.length,
          assessment: linkage.assessment?.status || 'none',
        });
      }
    } catch (error) {
      failed.push({ reference: application.reference, error: error.message });
    }
  }

  console.log(`Linked: ${linked.length}`);
  for (const row of linked) {
    console.log(`  ${row.reference} -> student ${row.student_id} | flags ${row.flags} | assessment ${row.assessment}`);
  }
  if (failed.length) {
    console.log(`Failed: ${failed.length}`);
    for (const row of failed) console.log(`  ${row.reference}: ${row.error}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
