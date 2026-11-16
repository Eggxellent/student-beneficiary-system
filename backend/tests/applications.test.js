const request = require('supertest');
const { randomInt, createHash } = require('crypto');
const app = require('../src/index');
const pool = require('../src/config/db');
const applicationRateLimit = require('../src/middleware/applicationRateLimit');

// The Python bridge is replaced here: these suites assert the application workflow, not the model.
// Scoring rules themselves are covered by the duplicate and ML suites.
jest.mock('../src/services/mlDuplicateReview', () => {
  const actual = jest.requireActual('../src/services/mlDuplicateReview');
  return { ...actual, scorePairs: jest.fn() };
});
const { scorePairs } = require('../src/services/mlDuplicateReview');

const createdApplicationIds = [];
const createdStudentIds = [];

function uniquePhone() {
  return `0788${String(randomInt(0, 1000000)).padStart(6, '0')}`;
}

function validApplication(overrides = {}) {
  const suffix = `${Date.now()}${randomInt(1000, 9999)}`;
  return {
    full_name: 'Guardian Led Applicant',
    date_of_birth: '2011-06-15',
    school_code: 'Nairobi School',
    guardian_name: 'Guardian Led Parent',
    guardian_phone: uniquePhone(),
    relationship_to_student: 'mother',
    upi: `UPI-APL-${suffix}`,
    ...overrides,
  };
}

async function submitApplication(body) {
  const response = await request(app).post('/api/applications').send(body);
  if (response.body?.application?.id) createdApplicationIds.push(response.body.application.id);
  return response;
}

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
  await pool.end();
});


describe('POST /api/applications', () => {
  jest.setTimeout(30000);

  test('accepts a complete application and returns a one-time tracking code', async () => {
    const body = validApplication();
    const response = await submitApplication(body);

    expect(response.status).toBe(201);
    expect(response.body.tracking_code).toMatch(/^[2-9A-HJ-NP-Z]{10}$/);
    expect(response.body.application.status).toBe('screened');

    const { rows } = await pool.query(
      'SELECT tracking_code_hash, status, submitted_payload, guardian_phone FROM student_applications WHERE id = $1',
      [response.body.application.id],
    );
    expect(rows[0].status).toBe('screened');
    expect(rows[0].tracking_code_hash).toBe(createHash('sha256').update(response.body.tracking_code).digest('hex'));
    expect(rows[0].submitted_payload).toMatchObject({ full_name: body.full_name, school_code: body.school_code });
    expect(rows[0].guardian_phone).toBe(`+254${body.guardian_phone.slice(1)}`);

    const { rows: actions } = await pool.query(
      `SELECT action FROM audit_logs WHERE table_name = 'student_applications' AND record_id = $1
        ORDER BY created_at ASC`,
      [response.body.application.id],
    );
    expect(actions.map((row) => row.action)).toEqual(['APPLICATION_SUBMITTED', 'APPLICATION_SCREENED']);
  });

  test('refuses an application that carries no identifier at all', async () => {
    const body = validApplication();
    delete body.upi;
    const response = await submitApplication(body);
    expect(response.status).toBe(400);
    expect(response.body.errors).toBeDefined();
  });

  test('refuses a second application for the same child within 24 hours', async () => {
    const body = validApplication();
    expect((await submitApplication(body)).status).toBe(201);

    // The same guardian resubmitting the same child is the case the rule is written for; a different
    // guardian submitting the same child is a duplicate case for human review, not a refused request.
    const repeat = await submitApplication(body);
    expect(repeat.status).toBe(409);
    expect(repeat.body.code).toBe('APPLICATION_ALREADY_SUBMITTED');
  });

  test('opens an advisory duplicate case without creating or editing a student', async () => {
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

    const response = await submitApplication(body);
    expect(response.status).toBe(201);
    expect(response.body.application.screening.cases_opened).toBe(1);

    const { rows: cases } = await pool.query(
      'SELECT application_id, student_id, matched_student_id, status FROM duplicate_flags WHERE application_id = $1',
      [response.body.application.id],
    );
    expect(cases).toHaveLength(1);
    expect(cases[0].student_id).toBeNull();
    expect(cases[0].matched_student_id).toBe(studentRows[0].id);
    expect(cases[0].status).toBe('pending');

    const { rows: studentCount } = await pool.query('SELECT count(*)::int AS total FROM students WHERE upi = $1', [body.upi]);
    expect(studentCount[0].total).toBe(1);
  });

  test('records screening unavailability instead of losing the submission', async () => {
    scorePairs.mockRejectedValueOnce(new Error('predictor unavailable'));
    const response = await submitApplication(validApplication());

    expect(response.status).toBe(201);
    expect(response.body.application.screening.failure_code).toBe('DUPLICATE_SCREENING_UNAVAILABLE');

    const { rows } = await pool.query(
      'SELECT status, screening_failure_code FROM student_applications WHERE id = $1',
      [response.body.application.id],
    );
    expect(rows[0].status).toBe('screened');
    expect(rows[0].screening_failure_code).toBe('DUPLICATE_SCREENING_UNAVAILABLE');
  });

  test('refuses more than five submissions from one client per hour', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post('/api/applications').send({});
      expect(response.status).toBe(400);
    }
    const limited = await request(app).post('/api/applications').send({});
    expect(limited.status).toBe(429);
  });
});


describe('POST /api/applications/track', () => {
  jest.setTimeout(30000);

  test('returns the application and its timeline to a guardian who knows the code and date of birth', async () => {
    const body = validApplication();
    const submitted = await submitApplication(body);
    expect(submitted.status).toBe(201);

    const tracked = await request(app).post('/api/applications/track').send({
      tracking_code: submitted.body.tracking_code,
      date_of_birth: body.date_of_birth,
    });
    expect(tracked.status).toBe(200);
    expect(tracked.body.application.status).toBe('screened');
    expect(tracked.body.application.full_name).toBe(body.full_name);
    expect(tracked.body.timeline.map((entry) => entry.action))
      .toEqual(['APPLICATION_SUBMITTED', 'APPLICATION_SCREENED']);
    // No identifier, score or matched record is disclosed.
    expect(JSON.stringify(tracked.body)).not.toContain(body.upi);
  });

  test('reveals nothing when the date of birth or the code is wrong', async () => {
    const body = validApplication();
    const submitted = await submitApplication(body);
    expect(submitted.status).toBe(201);

    const wrongDob = await request(app).post('/api/applications/track').send({
      tracking_code: submitted.body.tracking_code,
      date_of_birth: '2010-01-01',
    });
    expect(wrongDob.status).toBe(404);

    const wrongCode = await request(app).post('/api/applications/track').send({
      tracking_code: 'ZZZZZZZZZZ',
      date_of_birth: body.date_of_birth,
    });
    expect(wrongCode.status).toBe(404);
  });
});
