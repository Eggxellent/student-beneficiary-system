const request = require('supertest');
const { randomInt } = require('crypto');
const bcrypt = require('bcrypt');
const app = require('../src/index');
const pool = require('../src/config/db');
const applicationRateLimit = require('../src/middleware/applicationRateLimit');

// Closure is a decision about a record, not a scoring question: the model is stubbed so these tests
// never depend on the Python bridge.
jest.mock('../src/services/mlDuplicateReview', () => {
  const actual = jest.requireActual('../src/services/mlDuplicateReview');
  return { ...actual, scorePairs: jest.fn() };
});
const { scorePairs } = require('../src/services/mlDuplicateReview');

const createdApplicationIds = [];
const createdStudentIds = [];
const createdUserIds = [];

async function loginAs(role) {
  const email = `closure-${role}-${Date.now()}${randomInt(1000, 9999)}@example.test`;
  const password = 'ClosurePassword123!';
  const passwordHash = await bcrypt.hash(password, 4);
  const { rows } = await pool.query(
    'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [`Closure ${role}`, email, passwordHash, role],
  );
  createdUserIds.push(rows[0].id);
  const response = await request(app)
    .post(role === 'admin' ? '/api/auth/login/admin' : '/api/auth/login/field-officer')
    .send({ email, password });
  return response.body.token;
}

function validApplication(overrides = {}) {
  const suffix = `${Date.now()}${randomInt(1000, 9999)}`;
  return {
    full_name: 'Closure Review Applicant',
    date_of_birth: '2011-06-15',
    school_code: 'Nairobi School',
    guardian_name: 'Closure Review Parent',
    guardian_phone: `0788${String(randomInt(0, 1000000)).padStart(6, '0')}`,
    relationship_to_student: 'mother',
    upi: `UPI-CLS-${suffix}`,
    ...overrides,
  };
}

async function submitApplication(body) {
  const response = await request(app).post('/api/applications').send(body);
  if (response.body?.application?.id) createdApplicationIds.push(response.body.application.id);
  return response;
}

const ELIGIBILITY = {
  fee_balance: 12000,
  household_income: 18000,
  vulnerability_status: 'high',
  siblings_in_school: 2,
  prior_bursary_history: 'none',
};

beforeEach(() => {
  applicationRateLimit.reset();
  applicationRateLimit.resetTracking();
  scorePairs.mockReset();
  scorePairs.mockImplementation(async (pairs) => ({
    model_version: 'test-model',
    results: pairs.map(() => ({ score: 0.1, features: { full_name_similarity: 0.1 } })),
  }));
});

afterAll(async () => {
  if (createdApplicationIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE table_name = $1 AND record_id = ANY($2::uuid[])', [
      'student_applications', createdApplicationIds,
    ]);
    await pool.query('DELETE FROM student_applications WHERE id = ANY($1::uuid[])', [createdApplicationIds]);
  }
  if (createdStudentIds.length) {
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [createdStudentIds]);
  }
  if (createdUserIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [createdUserIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
  }
  await pool.end();
});

describe('Application closure', () => {
  jest.setTimeout(30000);

  test('rejects an application with a written reason and closes the verification path', async () => {
    const officerToken = await loginAs('field_officer');
    const adminToken = await loginAs('admin');
    const submitted = await submitApplication(validApplication());
    expect(submitted.status).toBe(201);
    const applicationId = submitted.body.application.id;

    const tooShort = await request(app)
      .post(`/api/applications/${applicationId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'too short' });
    expect(tooShort.status).toBe(400);

    const reason = 'Identity documents do not match the school register for this child.';
    const rejection = await request(app)
      .post(`/api/applications/${applicationId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason });
    expect(rejection.status).toBe(200);
    expect(rejection.body).toMatchObject({ status: 'rejected', previous_status: 'screened' });

    const { rows } = await pool.query(
      'SELECT status, closure_reason, closed_by, closed_at FROM student_applications WHERE id = $1',
      [applicationId],
    );
    expect(rows[0].status).toBe('rejected');
    expect(rows[0].closure_reason).toBe(reason);
    expect(rows[0].closed_at).toBeTruthy();
    expect(rows[0].closed_by).toBeTruthy();

    const audit = await pool.query(
      `SELECT details FROM audit_logs
        WHERE table_name = 'student_applications' AND record_id = $1
          AND action = 'APPLICATION_REJECTED'`,
      [applicationId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].details).toMatchObject({ previous_status: 'screened', next_status: 'rejected', role: 'admin' });

    // A closed application is evidence, not a work item: verification must refuse it.
    const verify = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ eligibility: ELIGIBILITY });
    expect(verify.status).toBe(409);
    expect(verify.body.code).toBe('INVALID_STATE');

    // Closing twice would overwrite the reason the first administrator recorded.
    const again = await request(app)
      .post(`/api/applications/${applicationId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'A second rejection must not replace the first reason.' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_STATE');

    const { rows: students } = await pool.query('SELECT count(*)::int AS total FROM students WHERE full_name = $1', [
      'Closure Review Applicant',
    ]);
    expect(students[0].total).toBe(0);
  });

  test('refuses a field officer rejection and lets the officer record a withdrawal', async () => {
    const officerToken = await loginAs('field_officer');
    const submitted = await submitApplication(validApplication());
    expect(submitted.status).toBe(201);
    const applicationId = submitted.body.application.id;

    const refused = await request(app)
      .post(`/api/applications/${applicationId}/reject`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ reason: 'The guardian asked for the application to be withdrawn.' });
    expect(refused.status).toBe(403);

    const withdrawal = await request(app)
      .post(`/api/applications/${applicationId}/withdraw`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ reason: 'The guardian asked for the application to be withdrawn.' });
    expect(withdrawal.status).toBe(200);
    expect(withdrawal.body).toMatchObject({ status: 'withdrawn', previous_status: 'screened' });

    // The detail read carries the closure evidence, so a later reader does not need the audit log.
    const detail = await request(app)
      .get(`/api/applications/${applicationId}`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.application.status).toBe('withdrawn');
    expect(detail.body.application.closure_reason).toBe('The guardian asked for the application to be withdrawn.');
    expect(detail.body.application.closed_at).toBeTruthy();
    expect(detail.body.application.closed_by).toBeTruthy();

    const audit = await pool.query(
      `SELECT details FROM audit_logs
        WHERE table_name = 'student_applications' AND record_id = $1
          AND action = 'APPLICATION_WITHDRAWN'`,
      [applicationId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].details.role).toBe('field_officer');

    const verify = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ eligibility: ELIGIBILITY });
    expect(verify.status).toBe(409);
    expect(verify.body.code).toBe('INVALID_STATE');
  });

  test('blocks closure while a duplicate case is still open', async () => {
    const adminToken = await loginAs('admin');
    const body = validApplication();
    const { rows: studentRows } = await pool.query(
      `INSERT INTO students (full_name, date_of_birth, school_code, upi)
       VALUES ($1, '2011-06-15', 'Nairobi School', $2) RETURNING id`,
      [body.full_name, body.upi],
    );
    createdStudentIds.push(studentRows[0].id);
    scorePairs.mockImplementation(async (pairs) => ({
      model_version: 'test-model',
      results: pairs.map(() => ({ score: 0.96, features: { full_name_similarity: 1 } })),
    }));

    const submitted = await submitApplication(body);
    expect(submitted.status).toBe(201);
    expect(submitted.body.application.screening.cases_opened).toBe(1);
    const applicationId = submitted.body.application.id;

    const closure = await request(app)
      .post(`/api/applications/${applicationId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Rejecting without resolving the duplicate case must not be possible.' });
    expect(closure.status).toBe(409);
    expect(closure.body.code).toBe('OPEN_DUPLICATE_CASE');

    const { rows } = await pool.query('SELECT status, closed_at FROM student_applications WHERE id = $1', [applicationId]);
    expect(rows[0].status).toBe('screened');
    expect(rows[0].closed_at).toBeNull();
  });
});

