const pool = require('../src/config/db');

// Regression guards for the two 20261116 migrations. They run against the guarded local sbms_test
// database inside a transaction that is rolled back, so no application row survives the suite.
// The rules asserted here are the ones a future refactor is most likely to break: the submitted
// payload is evidence, one code resolves to one application, and an application case can never be
// confused with a registration case.
describe('Guardian-led application schema', () => {
  jest.setTimeout(30000);
  let client;

  const insertApplication = (code, overrides = {}) => client.query(
    `INSERT INTO student_applications
       (tracking_code_hash, submitted_payload, guardian_name, guardian_phone,
        full_name, date_of_birth, school_code, upi)
     VALUES ($1, '{"submitted": true}'::jsonb, $2, $3, $4, '2012-04-05', $5, $6)
     RETURNING id`,
    [
      code,
      overrides.guardianName || 'Guardian Only',
      overrides.guardianPhone || '0700000000',
      overrides.fullName || 'Test Child',
      overrides.schoolCode || 'Nairobi School',
      overrides.upi || `UPI-${code}`,
    ],
  );

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('SELECT 1');
  });

  beforeEach(async () => {
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
  });

  // A refused statement aborts the surrounding transaction, so every negative assertion is made
  // inside a savepoint that is rolled back immediately afterwards.
  async function expectRefused(sql, params, expected) {
    await client.query('SAVEPOINT probe');
    let error;
    try {
      await client.query(sql, params);
    } catch (caught) {
      error = caught;
    }
    await client.query('ROLLBACK TO SAVEPOINT probe');
    expect(error).toBeDefined();
    if (expected instanceof RegExp) expect(error.message).toMatch(expected);
    else expect(error.code).toBe(expected);
  }

  afterAll(async () => {
    client.release();
    await pool.end();
  });

  test('the submitted payload cannot be edited after submission', async () => {
    const { rows } = await insertApplication('schema-test-immutable');
    await expectRefused(
      'UPDATE student_applications SET submitted_payload = $1::jsonb WHERE id = $2',
      ['{"submitted": false}', rows[0].id],
      /immutable/,
    );
  });

  test('a tracking code resolves to exactly one application', async () => {
    await insertApplication('schema-test-code');
    await expectRefused(
      `INSERT INTO student_applications
         (tracking_code_hash, submitted_payload, guardian_name, guardian_phone,
          full_name, date_of_birth, school_code, upi)
       VALUES ('schema-test-code', '{}'::jsonb, 'G', '0700000001', 'Other Child', '2013-01-01', 'Alliance High', 'UPI-other')`,
      [],
      '23505',
    );
  });

  test('an application without any identifier or with an unsupported school is refused', async () => {
    await expectRefused(
      `INSERT INTO student_applications
         (tracking_code_hash, submitted_payload, guardian_name, guardian_phone, full_name, date_of_birth, school_code)
       VALUES ('schema-test-noid', '{}'::jsonb, 'G', '0700000003', 'Test Child', '2012-04-05', 'Alliance High')`,
      [],
      '23514',
    );
    await expectRefused(
      `INSERT INTO student_applications
         (tracking_code_hash, submitted_payload, guardian_name, guardian_phone,
          full_name, date_of_birth, school_code, upi)
       VALUES ('schema-test-school', '{}'::jsonb, 'G', '0700000004', 'Test Child', '2012-04-05', 'Unlisted School', 'UPI-x')`,
      [],
      '23514',
    );
  });

  test('an application can hold one case per matched student, and re-screening cannot create a second', async () => {
    const student = await client.query('SELECT id FROM students LIMIT 1');
    const matchedStudentId = student.rows[0].id;
    const first = await insertApplication('schema-test-case-a');
    const second = await insertApplication('schema-test-case-b');

    const caseRow = await client.query(
      `INSERT INTO duplicate_flags (application_id, matched_student_id, probability, status)
       VALUES ($1, $2, 0.9, 'pending') RETURNING id`,
      [first.rows[0].id, matchedStudentId],
    );
    expect(caseRow.rowCount).toBe(1);

    await expectRefused(
      `INSERT INTO duplicate_flags (application_id, matched_student_id, probability, status)
       VALUES ($1, $2, 0.7, 'pending')`,
      [first.rows[0].id, matchedStudentId],
      '23505',
    );

    // Two different applications pointing at the same student must both be allowed: PostgreSQL's
    // LEAST/GREATEST ignore NULL and would otherwise collapse them into one index key.
    const secondCase = await client.query(
      `INSERT INTO duplicate_flags (application_id, matched_student_id, probability, status)
       VALUES ($1, $2, 0.8, 'pending') RETURNING id`,
      [second.rows[0].id, matchedStudentId],
    );
    expect(secondCase.rowCount).toBe(1);
  });

  test('a case with neither a student nor an application is refused', async () => {
    const student = await client.query('SELECT id FROM students LIMIT 1');
    await expectRefused(
      `INSERT INTO duplicate_flags (matched_student_id, probability, status) VALUES ($1, 0.5, 'pending')`,
      [student.rows[0].id],
      '23514',
    );
  });

  // duplicate_flags_case_kind_check: an application case names the application and a matched
  // student; the legacy registration case names the registering student. Never both, so every
  // reader can decide the subject from the row alone.
  test('a case cannot name both a student and an application as its subject', async () => {
    const student = await client.query('SELECT id FROM students LIMIT 1');
    const app = await insertApplication('schema-test-both');
    await expectRefused(
      `INSERT INTO duplicate_flags (student_id, application_id, matched_student_id, probability, status)
       VALUES ($1, $2, $1, 0.7, 'pending')`,
      [student.rows[0].id, app.rows[0].id],
      '23514',
    );
  });

  test('the submission guard index exists', async () => {
    const { rows } = await client.query(
      `SELECT indexdef FROM pg_indexes
        WHERE indexname = 'student_applications_guardian_child_idx'`,
    );
    expect(rows).toHaveLength(1);
  });

  test('review events record the reviewing stage', async () => {
    const student = await client.query('SELECT id FROM students LIMIT 1');
    const app = await insertApplication('schema-test-stage');
    const flag = await client.query(
      `INSERT INTO duplicate_flags (application_id, matched_student_id, probability, status)
       VALUES ($1, $2, 0.9, 'pending') RETURNING id`,
      [app.rows[0].id, student.rows[0].id],
    );
    const event = await client.query(
      `INSERT INTO duplicate_review_events (duplicate_flag_id, reviewer_id, decision, reason, stage)
       SELECT $1, id, 'needs_verification', 'Opening investigation', 'field_investigation' FROM users LIMIT 1`,
      [flag.rows[0].id],
    );
    expect(event.rowCount).toBe(1);
    await expectRefused(
      `INSERT INTO duplicate_review_events (duplicate_flag_id, reviewer_id, decision, reason, stage)
       SELECT $1, id, 'needs_verification', 'x', 'guardian_review' FROM users LIMIT 1`,
      [flag.rows[0].id],
      '23514',
    );
  });
});
