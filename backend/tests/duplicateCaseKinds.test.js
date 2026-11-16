const request = require('supertest');
const bcrypt = require('bcrypt');
const { randomInt } = require('crypto');
const app = require('../src/index');
const pool = require('../src/config/db');

// One queue, two case kinds. These suites assert that an application-linked case (student_id NULL)
// is visible, revealable and decidable through the same endpoints as a registration case, and that
// the decision moves the application with it (docs/phase3-duplicate-schema-review.md section 3.4).
const state = { userIds: [], applicationIds: [], studentIds: [], flagIds: [], token: null };

function suffix() {
  return `${Date.now()}${randomInt(1000, 9999)}`;
}

async function loginAsAdmin() {
  const email = `case-kinds-${suffix()}@example.com`;
  const password = 'CaseKindsPassword123!';
  const account = await pool.query(
    'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    ['Case Kinds Admin', email, await bcrypt.hash(password, 12), 'admin'],
  );
  state.userIds.push(account.rows[0].id);
  const response = await request(app).post('/api/auth/login/admin').send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token;
}

async function seedApplicationCase() {
  const tag = suffix();
  const student = await pool.query(
    `INSERT INTO students (full_name, date_of_birth, school_code, upi)
     VALUES ('Matched Existing Child', '2008-05-05', 'Alliance High', $1) RETURNING id`,
    [`UPI-KIND-EXISTING-${tag}`],
  );
  state.studentIds.push(student.rows[0].id);

  const application = await pool.query(
    `INSERT INTO student_applications
       (tracking_code_hash, submitted_payload, guardian_name, guardian_phone,
        full_name, date_of_birth, school_code, upi, status)
     VALUES ($1, '{}'::jsonb, 'Kinds Guardian', '0711000000',
             'Case Kinds Child', '2011-01-01', 'Nairobi School', $2, 'screened')
     RETURNING id`,
    [`case-kinds-hash-${tag}`, `UPI-KIND-APP-${tag}`],
  );
  state.applicationIds.push(application.rows[0].id);

  const flag = await pool.query(
    `INSERT INTO duplicate_flags
       (application_id, matched_student_id, probability, status, model_version, review_threshold, comparison_features)
     VALUES ($1, $2, 0.93, 'pending', 'test-model', 0.8, '{"full_name_similarity": 0.9}'::jsonb)
     RETURNING id`,
    [application.rows[0].id, student.rows[0].id],
  );
  state.flagIds.push(flag.rows[0].id);

  return {
    applicationId: application.rows[0].id,
    applicationUpi: `UPI-KIND-APP-${tag}`,
    matchedStudentId: student.rows[0].id,
    flagId: flag.rows[0].id,
  };
}

beforeAll(async () => {
  state.token = await loginAsAdmin();
});

afterAll(async () => {
  if (state.flagIds.length) {
    await pool.query('DELETE FROM duplicate_review_events WHERE duplicate_flag_id = ANY($1::uuid[])', [state.flagIds]);
    await pool.query('DELETE FROM duplicate_flags WHERE id = ANY($1::uuid[])', [state.flagIds]);
  }
  if (state.applicationIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE table_name = $1 AND record_id = ANY($2::uuid[])', [
      'student_applications', state.applicationIds,
    ]);
    await pool.query('DELETE FROM student_applications WHERE id = ANY($1::uuid[])', [state.applicationIds]);
  }
  if (state.flagIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE table_name = $1 AND record_id = ANY($2::uuid[])', [
      'duplicate_flags', state.flagIds,
    ]);
  }
  if (state.studentIds.length) {
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [state.studentIds]);
  }
  if (state.userIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [state.userIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [state.userIds]);
  }
  await pool.end();
});


describe('Duplicate cases with an application subject', () => {
  jest.setTimeout(60000);

  test('the review queue lists an application case with the application as its subject', async () => {
    const { applicationId, applicationUpi, flagId } = await seedApplicationCase();

    const response = await request(app)
      .get('/api/duplicate-flags?status=open')
      .set('Authorization', `Bearer ${state.token}`);
    expect(response.status).toBe(200);

    const reviewCase = response.body.cases.find((entry) => entry.id === flagId);
    expect(reviewCase).toBeDefined();
    expect(reviewCase.subject_type).toBe('application');
    expect(reviewCase.application_id).toBe(applicationId);
    expect(reviewCase.students[0].record_type).toBe('application');
    expect(reviewCase.students[0].reference).toBe(applicationId);
    expect(reviewCase.students[0].full_name).toBe('Case Kinds Child');
    expect(reviewCase.students[0].school_code).toBe('Nairobi School');
    // The queue never returns a full identifier: only the last three characters survive masking.
    expect(reviewCase.students[0].upi).not.toBe(applicationUpi);
    expect(reviewCase.students[0].upi.endsWith(applicationUpi.slice(-3))).toBe(true);
    expect(reviewCase.students[1].record_type).toBe('student');
    expect(response.body.summary.high_priority_pending + response.body.summary.standard_review_pending)
      .toBeGreaterThanOrEqual(1);
  });

  test('identifiers can be revealed for an application case, and the reveal is audited', async () => {
    const { applicationId, applicationUpi, flagId } = await seedApplicationCase();

    const response = await request(app)
      .get(`/api/duplicate-flags/${flagId}/identifiers`)
      .set('Authorization', `Bearer ${state.token}`);
    expect(response.status).toBe(200);
    expect(response.body.subject_type).toBe('application');
    expect(response.body.students[0].record_type).toBe('application');
    expect(response.body.students[0].reference).toBe(applicationId);
    expect(response.body.students[0].upi).toBe(applicationUpi);
    expect(response.body.students[0].full_name).toBe('Case Kinds Child');

    const { rows } = await pool.query(
      `SELECT details FROM audit_logs
        WHERE action = 'REVEAL_DUPLICATE_IDENTIFIERS' AND record_id = $1`,
      [flagId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].details.application_id).toBe(applicationId);
  });

  test('clearing the case through the shared decision endpoint returns the application to screening', async () => {
    const { applicationId, flagId } = await seedApplicationCase();

    const response = await request(app)
      .patch(`/api/duplicate-flags/${flagId}`)
      .set('Authorization', `Bearer ${state.token}`)
      .send({ decision: 'not_duplicate', reason: 'Documents show a different child' });
    expect(response.status).toBe(200);
    expect(response.body.flag.status).toBe('not_duplicate');

    const { rows: applications } = await pool.query(
      'SELECT status FROM student_applications WHERE id = $1',
      [applicationId],
    );
    expect(applications[0].status).toBe('screened');

    const { rows: events } = await pool.query(
      'SELECT stage, decision FROM duplicate_review_events WHERE duplicate_flag_id = $1',
      [flagId],
    );
    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe('admin_review');
    expect(events[0].decision).toBe('not_duplicate');
  });

  test('confirming the duplicate through the shared decision endpoint resolves the application', async () => {
    const { applicationId, matchedStudentId, flagId } = await seedApplicationCase();

    const response = await request(app)
      .patch(`/api/duplicate-flags/${flagId}`)
      .set('Authorization', `Bearer ${state.token}`)
      .send({ decision: 'confirmed_duplicate', reason: 'Same child; the documents match' });
    expect(response.status).toBe(200);

    const { rows: applications } = await pool.query(
      'SELECT status, duplicate_of_student_id FROM student_applications WHERE id = $1',
      [applicationId],
    );
    expect(applications[0].status).toBe('resolved');
    expect(applications[0].duplicate_of_student_id).toBe(matchedStudentId);

    // The student-pair resolution endpoint needs two student rows, so it refuses an application case
    // by name instead of failing on a null student id.
    const resolution = await request(app)
      .post(`/api/duplicate-flags/${flagId}/resolution`)
      .set('Authorization', `Bearer ${state.token}`)
      .send({ canonical_student_id: matchedStudentId, reason: 'Designating the existing record' });
    expect(resolution.status).toBe(409);
    expect(resolution.body.code).toBe('APPLICATION_CASE');
  });
});
