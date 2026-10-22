require('dotenv').config();
const { Pool } = require('pg');
const {
  buildDuplicateFeatures,
  calculateDuplicateScore,
  classifyDuplicate,
  hasCorroboratingMajority,
  MIN_NAME_SIMILARITY,
} = require('../src/services/duplicateCheck');
const { getDuplicateThreshold, getReviewThreshold } = require('../src/config/settings');
const { comparisons, ordinaryStudents, records } = require('./kenyanSyntheticDataset');

const SEED_ID = 'sbms-kenyan-synthetic-v1';
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

function databaseTarget() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required (value will not be printed).');
  const url = new URL(process.env.DATABASE_URL);
  const host = url.hostname.toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host) || /prod|production/i.test(url.pathname)) {
    throw new Error('Refusing to use a non-local or production-looking database. Choose a dedicated local development/test database.');
  }
  return decodeURIComponent(url.pathname.replace(/^\//, ''));
}

function compareStudentData(existing, expected) {
  const keys = [
    'full_name', 'date_of_birth', 'school_code', 'guardian_id', 'upi',
    'national_id_number', 'birth_certificate_number', 'primary_phone', 'qr_token',
  ];
  const normalized = (value) => value == null
    ? null
    : value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
  return [
    ...keys.filter((key) => (key === 'date_of_birth' ? existing.seed_date_of_birth : normalized(existing[key])) !== normalized(expected[key])),
    ...(existing.is_synthetic === true ? [] : ['is_synthetic']),
  ];
}

function evaluateComparison(testCase) {
  const features = buildDuplicateFeatures(testCase.first, testCase.second);
  const probability = features.national_id_match ? 1 : calculateDuplicateScore(features);
  const candidate = features.jaro_winkler >= MIN_NAME_SIMILARITY
    || features.upi_match
    || features.birth_certificate_match
    || features.national_id_match
    || hasCorroboratingMajority(features);
  const riskLevel = classifyDuplicate(features, probability, getDuplicateThreshold(), getReviewThreshold());
  return { ...testCase, features, probability, candidate, riskLevel };
}

async function main() {
  const databaseName = databaseTarget();
  if (APPLY && process.env.SBMS_ALLOW_LOCAL_SYNTHETIC_SEED !== 'YES') {
    throw new Error('For writes, set SBMS_ALLOW_LOCAL_SYNTHETIC_SEED=YES and pass --apply.');
  }

  const evaluated = comparisons.map(evaluateComparison);
  const outcomeCounts = Object.fromEntries(['critical', 'duplicate', 'review', 'clear'].map((value) => [
    value, evaluated.filter((item) => item.riskLevel === value).length,
  ]));
  const eligible = evaluated.filter((item) => item.candidate && item.riskLevel !== 'clear');
  const caseCounts = Object.fromEntries([...new Set(comparisons.map((item) => item.category))].map((category) => [
    category, comparisons.filter((item) => item.category === category).length,
  ]));
  const scenarioOutcomes = Object.fromEntries(Object.keys(caseCounts).map((category) => [
    category,
    Object.fromEntries(['critical', 'duplicate', 'review', 'clear'].map((risk) => [
      risk, evaluated.filter((item) => item.category === category && item.riskLevel === risk).length,
    ])),
  ]));

  console.log(`Database: local database "${databaseName}"`);
  console.log(`Synthetic student records planned: ${records.length} (${ordinaryStudents.length} ordinary records included)`);
  console.log(`Curated comparison pairs evaluated with current application rules: ${evaluated.length}`);
  console.log(`Decision outcomes: ${JSON.stringify(outcomeCounts)}`);
  console.log(`Pending review flags eligible to seed: ${eligible.length}`);
  console.log(`Scenario pairs: ${JSON.stringify(caseCounts)}`);
  console.log(`Scenario outcomes: ${JSON.stringify(scenarioOutcomes)}`);
  console.log(`Scholarship disbursement examples planned: ${ordinaryStudents.length}`);
  if (!APPLY) {
    console.log('Dry run only. To add these marked records to this local development database, review the target, then set SBMS_ALLOW_LOCAL_SYNTHETIC_SEED=YES and pass --apply. No rows were written.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT is_synthetic FROM students LIMIT 0');
    const idsByCode = new Map();
    let studentsInserted = 0;
    for (const record of records) {
      const { rows: existingRows } = await client.query(
        "SELECT *, TO_CHAR(date_of_birth, 'YYYY-MM-DD') AS seed_date_of_birth FROM students WHERE qr_token = $1",
        [record.qr_token]
      );
      let student = existingRows[0];
      if (student) {
        const mismatches = compareStudentData(student, record);
        if (mismatches.length) throw new Error(`Synthetic marker collision for record ${record.code} (fields: ${mismatches.join(', ')}); refusing to overwrite it.`);
      } else {
        const inserted = await client.query(
          `INSERT INTO students (
             full_name, date_of_birth, school_code, guardian_id, upi,
             national_id_number, birth_certificate_number, primary_phone, qr_token, is_synthetic
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING *`,
          [record.full_name, record.date_of_birth, record.school_code, record.guardian_id, record.upi,
            record.national_id_number, record.birth_certificate_number, record.primary_phone, record.qr_token]
        );
        student = inserted.rows[0];
        studentsInserted += 1;
      }
      idsByCode.set(record.code, student.id);
    }

    const seededByCategory = {};
    let flagsInserted = 0;
    let flagsAlreadyPresent = 0;
    for (const item of eligible) {
      const firstId = idsByCode.get(item.first.code);
      const secondId = idsByCode.get(item.second.code);
      const existingFlag = await client.query(
        `SELECT id FROM duplicate_flags
         WHERE (student_id = $1 AND matched_student_id = $2)
            OR (student_id = $2 AND matched_student_id = $1)
         LIMIT 1`,
        [firstId, secondId]
      );
      if (existingFlag.rows.length) {
        flagsAlreadyPresent += 1;
      } else {
        await client.query(
          `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
           VALUES ($1, $2, $3, 'pending')`,
          [firstId, secondId, item.probability]
        );
        flagsInserted += 1;
      }
      seededByCategory[item.category] = (seededByCategory[item.category] || 0) + 1;
    }

    let disbursementsInserted = 0;
    for (let index = 0; index < ordinaryStudents.length; index += 1) {
      const record = ordinaryStudents[index];
      const studentId = idsByCode.get(record.code);
      const amount = [8500, 12000, 15000, 18000, 22000, 10000, 13500, 24500][index];
      const date = `2026-${String(index + 1).padStart(2, '0')}-15`;
      const existingPayment = await client.query(
        `SELECT id FROM disbursements
         WHERE student_id = $1 AND amount = $2 AND disbursement_date = $3 AND created_by IS NULL LIMIT 1`,
        [studentId, amount, date]
      );
      if (!existingPayment.rows.length) {
        await client.query(
          `INSERT INTO disbursements (student_id, amount, disbursement_date, status)
           VALUES ($1, $2, $3, 'completed')`,
          [studentId, amount, date]
        );
        disbursementsInserted += 1;
      }
    }

    if (studentsInserted || flagsInserted || disbursementsInserted) {
      await client.query(
        `INSERT INTO audit_logs (action, table_name, details)
         VALUES ('SEED_SYNTHETIC_KENYAN_TEST_DATA', 'students', $1)`,
        [{ seed_id: SEED_ID, synthetic: true, students_inserted: studentsInserted, review_flags_inserted: flagsInserted, review_flags_existing: flagsAlreadyPresent, disbursements_inserted: disbursementsInserted, comparisons: evaluated.length, scenario_pairs: caseCounts, outcomes: outcomeCounts }]
      );
    }
    await client.query('COMMIT');
    console.log(`Seed applied (idempotent). New students: ${studentsInserted}/${records.length}; new pending review flags: ${flagsInserted}; already-present eligible flags: ${flagsAlreadyPresent}; new sample disbursements: ${disbursementsInserted}/${ordinaryStudents.length}.`);
    console.log(`Scenario flags created or already present: ${JSON.stringify(seededByCategory)}.`);
    console.log('Duplicate cases are available to Admin users for review.');
    console.log('Every seeded student has is_synthetic=true and an SBMS-SYNTHETIC QR marker. No existing record was updated or deleted.');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(`Synthetic seed failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => pool.end());
