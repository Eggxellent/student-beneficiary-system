const request = require('supertest');
const bcrypt = require('bcrypt');
const { randomInt } = require('crypto');
const app = require('../src/index');
const pool = require('../src/config/db');
const applicationRateLimit = require('../src/middleware/applicationRateLimit');

// The workflow is what is under test here; the model is replaced by a fixed score so a case can be
// opened deliberately.
jest.mock('../src/services/mlDuplicateReview', () => {
  const actual = jest.requireActual('../src/services/mlDuplicateReview');
  return { ...actual, scorePairs: jest.fn() };
});
const { scorePairs } = require('../src/services/mlDuplicateReview');

const state = {
  employeeIds: [],
  applicationIds: [],
  studentIds: [],
  tokens: {},
};

const ELIGIBILITY = {
  fee_balance: 24500,
  household_income: 12000,
  vulnerability_status: 'high',
  siblings_in_school: 3,
  prior_bursary_history: 'none',
};

function uniqueSuffix() {
  return `${Date.now()}${randomInt(1000, 9999)}`;
}

function applicationBody(overrides = {}) {
  const suffix = uniqueSuffix();
  return {
    full_name: 'Workflow Test Child',
    date_of_birth: '2010-03-11',
    school_code: 'Alliance High',
    guardian_name: 'Workflow Test Guardian',
    guardian_phone: `0790${String(randomInt(0, 1000000)).padStart(6, '0')}`,
    relationship_to_student: 'father',
    upi: `UPI-WF-${suffix}`,
    ...overrides,
  };
}

async function loginAs(role) {
  const email = `workflow-${role}-${uniqueSuffix()}@example.com`;
  const password = 'WorkflowPassword123!';
  const passwordHash = await bcrypt.hash(password, 12);
  const account = await pool.query(
    'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
    [`Workflow ${role}`, email, passwordHash, role],
  );
  state.employeeIds.push(account.rows[0].id);
  const path = role === 'admin' ? '/api/auth/login/admin' : '/api/auth/login/field-officer';
  const response = await request(app).post(path).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.token;
}

async function submitWithCase(body, score = 0.96) {
  const { rows } = await pool.query(
    `INSERT INTO students (full_name, date_of_birth, school_code, upi)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [body.full_name, body.date_of_birth, body.school_code, body.upi],
  );
  state.studentIds.push(rows[0].id);

  scorePairs.mockImplementation(async (pairs) => ({
    model_version: 'test-model',
    results: pairs.map(() => ({ score, features: { full_name_similarity: 1 } })),
  }));

  const submitted = await request(app).post('/api/applications').send(body);
  expect(submitted.status).toBe(201);
  state.applicationIds.push(submitted.body.application.id);
  expect(submitted.body.application.screening.cases_opened).toBe(1);

  const { rows: cases } = await pool.query(
    `SELECT id, matched_student_id FROM duplicate_flags WHERE application_id = $1`,
    [submitted.body.application.id],
  );
  return {
    applicationId: submitted.body.application.id,
    caseId: cases[0].id,
    matchedStudentId: cases[0].matched_student_id,
  };
}

beforeAll(async () => {
  applicationRateLimit.reset();
  applicationRateLimit.resetTracking();
  state.tokens.field_officer = await loginAs('field_officer');
  state.tokens.admin = await loginAs('admin');
});

afterAll(async () => {
  if (state.applicationIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE table_name = $1 AND record_id = ANY($2::uuid[])', [
      'student_applications', state.applicationIds,
    ]);
    await pool.query('DELETE FROM student_applications WHERE id = ANY($1::uuid[])', [state.applicationIds]);
  }
  if (state.studentIds.length) {
    await pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [state.studentIds]);
  }
  if (state.employeeIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [state.employeeIds]);
    await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [state.employeeIds]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [state.employeeIds]);
  }
  await pool.end();
});

describe('Guardian application workflow', () => {
  jest.setTimeout(60000);

  test('triage is an administrator action and requires an open duplicate case', async () => {
    const { applicationId } = await submitWithCase(applicationBody());

    const byOfficer = await request(app)
      .post(`/api/applications/${applicationId}/triage`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({ reason: 'I think this is a duplicate' });
    expect(byOfficer.status).toBe(403);

    const byAdmin = await request(app)
      .post(`/api/applications/${applicationId}/triage`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({ reason: 'High score and the same UPI, a visit is needed' });
    expect(byAdmin.status).toBe(200);
    expect(byAdmin.body.status).toBe('needs_investigation');

    const repeated = await request(app)
      .post(`/api/applications/${applicationId}/triage`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({ reason: 'Trying to triage twice' });
    expect(repeated.status).toBe(409);
    expect(repeated.body.code).toBe('INVALID_STATE');
  });

  test('investigation is a field-officer finding and clearing the case returns the application to screening', async () => {
    const { applicationId } = await submitWithCase(applicationBody());
    await request(app)
      .post(`/api/applications/${applicationId}/triage`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({ reason: 'Needs a home visit' });

    const byAdmin = await request(app)
      .post(`/api/applications/${applicationId}/investigation`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({ findings: 'Visited the home', recommendation: 'likely_duplicate' });
    expect(byAdmin.status).toBe(403);

    const byOfficer = await request(app)
      .post(`/api/applications/${applicationId}/investigation`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({ findings: 'Visited the home; the child is at a different school', recommendation: 'likely_not_duplicate' });
    expect(byOfficer.status).toBe(200);
    expect(byOfficer.body.status).toBe('investigated');

    const { rows: events } = await pool.query(
      `SELECT e.stage, e.notes FROM duplicate_review_events e
         JOIN duplicate_flags f ON f.id = e.duplicate_flag_id
        WHERE f.application_id = $1`,
      [applicationId],
    );
    expect(events).toHaveLength(1);
    expect(events[0].stage).toBe('field_investigation');
    expect(events[0].notes).toContain('likely_not_duplicate');

    const resolveByOfficer = await request(app)
      .post(`/api/applications/${applicationId}/resolve`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({ outcome: 'not_duplicate', reason: 'Different child, different household' });
    expect(resolveByOfficer.status).toBe(403);

    const resolveByAdmin = await request(app)
      .post(`/api/applications/${applicationId}/resolve`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({ outcome: 'not_duplicate', reason: 'Investigation found a different child' });
    expect(resolveByAdmin.status).toBe(200);
    expect(resolveByAdmin.body.status).toBe('screened');
  });

  test('verification creates the student with the assessment submitted at the visit', async () => {
    const body = applicationBody();
    const { applicationId, matchedStudentId } = await submitWithCase(body);

    // The case is cleared by the administrator, so nothing is open at verification.
    await request(app)
      .post(`/api/applications/${applicationId}/resolve`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({ outcome: 'not_duplicate', reason: 'Manual check found a different child' });

    const noAssessment = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({});
    expect(noAssessment.status).toBe(400);

    const verified = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({ eligibility: ELIGIBILITY });
    expect(verified.status).toBe(201);
    expect(verified.body.status).toBe('verified');
    expect(verified.body.student.upi).toBe(body.upi);
    state.studentIds.push(verified.body.student.id);

    const { rows: assessments } = await pool.query(
      'SELECT recorded_via, score FROM eligibility_assessments WHERE student_id = $1',
      [verified.body.student.id],
    );
    expect(assessments).toHaveLength(1);
    expect(assessments[0].recorded_via).toBe('application_verification');
    expect(assessments[0].score).toBe(verified.body.eligibility.score);

    const detailByAdmin = await request(app)
      .get(`/api/applications/${applicationId}`)
      .set('Authorization', `Bearer ${state.tokens.admin}`);
    expect(detailByAdmin.status).toBe(200);
    expect(detailByAdmin.body.application.upi).toMatch(/^\*{4}/);

    const detailByOfficer = await request(app)
      .get(`/api/applications/${applicationId}`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`);
    expect(detailByOfficer.status).toBe(200);
    expect(detailByOfficer.body.application.upi).toBe(body.upi);
    expect(detailByOfficer.body.duplicate_cases[0].matched_upi).toBe(body.upi);
  });

  test('an open high-priority case blocks the field officer, and the administrator override is audited', async () => {
    const { applicationId } = await submitWithCase(applicationBody());

    const blocked = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({ eligibility: ELIGIBILITY });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe('DUPLICATE_REVIEW_OPEN');

    const officerOverride = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({ eligibility: ELIGIBILITY, override_reason: 'I am certain this is a different child' });
    expect(officerOverride.status).toBe(403);
    expect(officerOverride.body.code).toBe('OVERRIDE_NOT_PERMITTED');

    const adminOverride = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({ eligibility: ELIGIBILITY, override_reason: 'Document check confirmed two different children with one shared guardian' });
    expect(adminOverride.status).toBe(201);
    expect(adminOverride.body.status).toBe('verified');
    state.studentIds.push(adminOverride.body.student.id);

    const { rows } = await pool.query(
      `SELECT details FROM audit_logs
        WHERE table_name = 'student_applications' AND record_id = $1 AND action = 'APPLICATION_VERIFIED'`,
      [applicationId],
    );
    expect(rows[0].details.duplicate_override).toBe(true);
    expect(rows[0].details.override_reason).toContain('two different children');
  });

  test('a confirmed duplicate never becomes a second student record', async () => {
    const body = applicationBody();
    const { applicationId, matchedStudentId } = await submitWithCase(body);

    const confirmed = await request(app)
      .post(`/api/applications/${applicationId}/resolve`)
      .set('Authorization', `Bearer ${state.tokens.admin}`)
      .send({
        outcome: 'duplicate_of_existing',
        canonical_student_id: matchedStudentId,
        reason: 'Same child already registered; documents match',
      });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.status).toBe('resolved');

    const verification = await request(app)
      .post(`/api/applications/${applicationId}/verify`)
      .set('Authorization', `Bearer ${state.tokens.field_officer}`)
      .send({ eligibility: ELIGIBILITY });
    expect(verification.status).toBe(409);
    expect(verification.body.code).toBe('DUPLICATE_APPLICATION');

    const { rows } = await pool.query('SELECT count(*)::int AS total FROM students WHERE upi = $1', [body.upi]);
    expect(rows[0].total).toBe(1);
  });
});

