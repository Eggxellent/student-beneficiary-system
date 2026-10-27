const request = require('supertest');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const app = require('../src/index');
const pool = require('../src/config/db');
const { getDuplicateThreshold, getReviewThreshold } = require('../src/config/settings');
const createdUserIds = [];

async function registerUserAndGetToken(role = 'admin') {
  const email = `duplicate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'TestPassword123!';

  if (role === 'admin') {
    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      ['Duplicate Admin', email, password_hash, role]
    );
    createdUserIds.push(rows[0].id);
  } else {
    const password_hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'field_officer') RETURNING id",
      ['Duplicate Officer', email, password_hash]
    );
    createdUserIds.push(rows[0].id);
  }

  const loginResponse = await request(app)
    .post(role === 'admin' ? '/api/auth/login/admin' : '/api/auth/login/field-officer')
    .send({ email, password });

  if (loginResponse.body.user?.id) createdUserIds.push(loginResponse.body.user.id);

  return loginResponse.body.token;
}

async function createStudent(overrides = {}) {
  const student = {
    full_name: `Student ${Date.now()} ${Math.random().toString(36).slice(2, 6)}`,
    date_of_birth: '2008-02-15',
    school_code: 'Nairobi School',
    guardian_id: 'G-100',
    upi: `UPI-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };

  const result = await pool.query(
    `INSERT INTO students (full_name, date_of_birth, school_code, guardian_id, upi)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [student.full_name, student.date_of_birth, student.school_code, student.guardian_id, student.upi]
  );

  return result.rows[0];
}

async function createApprovedVerifiedAward(student, actorId) {
  const result = await pool.query(
    `INSERT INTO bursary_awards
       (student_id, school_code, requested_amount, status, verification_status,
        verification_notes, verification_evidence_ref, verified_by, verified_at,
        approved_amount, decision_reason, decided_by, decided_at, submitted_by)
     VALUES ($1, $2, 5000, 'approved', 'verified', 'Isolated test fixture verified.',
        'test-fixture-evidence', $3, NOW(), 5000, 'Approved isolated test fixture.', $3, NOW(), $3)
     RETURNING id`,
    [student.id, student.school_code, actorId]
  );
  return result.rows[0].id;
}

describe('Duplicate flags and disbursements API', () => {
  jest.setTimeout(30000);
  let adminToken;
  let officerToken;

  beforeAll(async () => {
    adminToken = await registerUserAndGetToken('admin');
    officerToken = await registerUserAndGetToken('field_officer');
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await pool.query('DELETE FROM duplicate_flags WHERE resolved_by = ANY($1::uuid[])', [createdUserIds]);
      await pool.query('DELETE FROM duplicate_review_events WHERE reviewer_id = ANY($1::uuid[])', [createdUserIds]);
      await pool.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [createdUserIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdUserIds]);
    }
    await pool.end();
  });

  test('should expose a distinct review threshold below the duplicate threshold', () => {
    expect(getReviewThreshold()).toBeGreaterThan(0);
    expect(getReviewThreshold()).toBeLessThan(getDuplicateThreshold());
  });

  test('GET /api/duplicate-flags should return pending duplicate flags for admins', async () => {
    const sharedUpi = `UPI-SHARED-${Date.now()}`;
    const student = await createStudent({ full_name: `Pending Flag ${Date.now()}`, upi: sharedUpi });
    const matchedStudent = await createStudent({ full_name: `Matched Flag ${Date.now()}`, upi: sharedUpi });

    const flagResult = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [student.id, matchedStudent.id, 0.91]
    );

    const response = await request(app)
      .get('/api/duplicate-flags?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.body.cases)).toBe(true);
    expect(response.body.cases.some((flag) => flag.id === flagResult.rows[0].id)).toBe(true);
    const reviewCase = response.body.cases.find((flag) => flag.id === flagResult.rows[0].id);
    expect(reviewCase.students[0].upi).not.toBe(sharedUpi);
    expect(response.body.case_totals.unresolved).toBeGreaterThanOrEqual(1);

    expect(reviewCase.assigned_to).toBeUndefined();
    const officerAccess = await request(app).get('/api/duplicate-flags').set('Authorization', `Bearer ${officerToken}`);
    expect(officerAccess.statusCode).toBe(403);
    const officerDecision = await request(app).patch(`/api/duplicate-flags/${flagResult.rows[0].id}`)
      .set('Authorization', `Bearer ${officerToken}`).send({ decision: 'not_duplicate', reason: 'Only Admins review duplicate cases.' });
    expect(officerDecision.statusCode).toBe(403);

    await pool.query('DELETE FROM duplicate_flags WHERE id = $1', [flagResult.rows[0].id]);
    await pool.query('DELETE FROM students WHERE id = $1 OR id = $2', [student.id, matchedStudent.id]);
  });

  test('POST /api/duplicate-flags/evaluate scores synthetic pairs without saving them', async () => {
    const flagsBefore = await pool.query('SELECT COUNT(*)::int AS count FROM duplicate_flags');
    const response = await request(app)
      .post('/api/duplicate-flags/evaluate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        pairs: [
          {
            label: 'Exact certificate',
            first: { full_name: 'Nia Wanjiku', date_of_birth: '2011-05-14', school_code: 'SCH-A', guardian_id: 'G-A', upi: 'UPI-A', birth_certificate_number: 'BC-SHARED' },
            second: { full_name: 'David Otieno', date_of_birth: '2009-08-22', school_code: 'SCH-B', guardian_id: 'G-B', upi: 'UPI-B', birth_certificate_number: 'BC-SHARED' },
          },
          {
            label: 'Both unique identifiers',
            first: { full_name: 'Nia Wanjiku', date_of_birth: '2011-05-14', school_code: 'SCH-A', guardian_id: 'G-A', upi: 'UPI-SHARED', birth_certificate_number: 'BC-SHARED' },
            second: { full_name: 'David Otieno', date_of_birth: '2009-08-22', school_code: 'SCH-B', guardian_id: 'G-B', upi: 'UPI-SHARED', birth_certificate_number: 'BC-SHARED' },
          },
          {
            label: 'Non-unique overlap',
            first: { full_name: 'Miriam Chebet', date_of_birth: '2010-11-03', school_code: 'SCH-C', guardian_id: 'G-C', upi: 'UPI-C1', birth_certificate_number: 'BC-C1' },
            second: { full_name: 'Miriam Chebet', date_of_birth: '2010-11-03', school_code: 'SCH-C', guardian_id: 'G-C', upi: 'UPI-C2', birth_certificate_number: 'BC-C2' },
          },
          {
            label: 'Four strong partial matches below weighted review threshold',
            first: { full_name: 'Fatuma Wairimu', date_of_birth: '1980-04-12', school_code: 'SCH-4821765', guardian_id: 'G-4821765', upi: 'UPI-12345678', birth_certificate_number: 'BC-1980-123456' },
            second: { full_name: 'Amina Wanjiku', date_of_birth: '1980-09-09', school_code: 'SCH-4821750', guardian_id: 'G-4821750', upi: 'UPI-87654321', birth_certificate_number: 'BC-1980-654321' },
          },
          {
            label: 'Exact name and DOB only',
            first: { full_name: 'Amina Hassan', date_of_birth: '2010-05-14', school_code: 'SCH-014', guardian_id: 'G-123456', upi: 'UPI-12345678', birth_certificate_number: 'BC-2010-123456' },
            second: { full_name: 'Amina Hassan', date_of_birth: '2010-05-14', school_code: 'SCH-079', guardian_id: 'G-654321', upi: 'UPI-87654321', birth_certificate_number: 'BC-2010-654321' },
          },
        ],
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.results).toHaveLength(5);
    for (const result of response.body.results) {
      expect(typeof result.model_score).toBe('number');
      expect(result.model_score).toBeGreaterThanOrEqual(0);
      expect(result.model_score).toBeLessThanOrEqual(1);
      expect(result.model_features).toEqual(expect.objectContaining({
        jaro_winkler: expect.any(Number),
        dob_match: expect.any(Number),
        school_match: expect.any(Number),
        guardian_match: expect.any(Number),
        upi_match: expect.any(Number),
        birth_certificate_match: expect.any(Number),
      }));
      expect(result.model_version).toEqual(expect.any(String));
      expect(typeof result.requires_human_review).toBe('boolean');
      expect(result.score_is_calibrated_probability).toBe(false);
      expect(result.review_threshold).toEqual(expect.any(Number));
      expect(result).not.toHaveProperty('decision');
    }
    expect(response.body.results[0].requires_human_review).toBe(true);
    expect(response.body.results[1].requires_human_review).toBe(true);
    expect(response.body.model_version).toEqual(expect.any(String));
    const persistedFlags = await pool.query('SELECT COUNT(*)::int AS count FROM duplicate_flags');
    expect(persistedFlags.rows[0].count).toBe(flagsBefore.rows[0].count);
  }, 30000);

  test('POST /api/duplicate-flags/evaluate should reject non-admin users', async () => {
    const officerToken = await registerUserAndGetToken('field_officer');
    const response = await request(app)
      .post('/api/duplicate-flags/evaluate')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ pairs: [] });

    expect(response.statusCode).toBe(403);
  });

  test('admins review cases and decisions are recorded in case history', async () => {
    const student = await createStudent({ full_name: `Resolve Flag ${Date.now()}` });
    const matchedStudent = await createStudent({ full_name: `Resolve Match ${Date.now()}` });

    const flagResult = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [student.id, matchedStudent.id, 0.87]
    );

    const missingReason = await request(app)
      .patch(`/api/duplicate-flags/${flagResult.rows[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'not_duplicate' });
    expect(missingReason.statusCode).toBe(400);

    const verification = await request(app)
      .patch(`/api/duplicate-flags/${flagResult.rows[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'needs_verification', reason: 'The records do not include enough current evidence.' });
    expect(verification.statusCode).toBe(200);
    expect(verification.body.flag.status).toBe('needs_verification');

    const response = await request(app)
      .patch(`/api/duplicate-flags/${flagResult.rows[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'not_duplicate', reason: 'Checked both source records and confirmed they are different students.' });

    expect(response.statusCode).toBe(200);
    expect(response.body.message).toMatch(/decision recorded/i);
    expect(response.body.flag.status).toBe('not_duplicate');

    const history = await request(app)
      .get('/api/duplicate-flags?status=not_duplicate')
      .set('Authorization', `Bearer ${adminToken}`);
    const reviewed = history.body.cases.find((item) => item.id === flagResult.rows[0].id);
    expect(reviewed.history[0].reason).toMatch(/checked both source records/i);
    expect(reviewed.history).toHaveLength(2);
    expect(reviewed.history[0].reviewer_name).toBe('Duplicate Admin');
    const decisionAudit = await pool.query(
      "SELECT user_id, details FROM audit_logs WHERE record_id = $1 AND action = 'DUPLICATE_NOT_DUPLICATE' ORDER BY created_at DESC LIMIT 1",
      [flagResult.rows[0].id]
    );
    const adminId = jwt.decode(adminToken).id;
    expect(decisionAudit.rows[0].user_id).toBe(adminId);
    expect(decisionAudit.rows[0].details.decision).toBe('not_duplicate');
    expect(decisionAudit.rows[0].details.reason).toMatch(/checked both source records/i);
    await pool.query('DELETE FROM duplicate_flags WHERE id = $1', [flagResult.rows[0].id]);
    await pool.query('DELETE FROM students WHERE id = $1 OR id = $2', [student.id, matchedStudent.id]);
  });

  test('POST /api/disbursements blocks a pair after a reviewer confirms a duplicate', async () => {
    const student = await createStudent({ full_name: `Blocked Student ${Date.now()}` });
    const matchedStudent = await createStudent({ full_name: `Blocked Match ${Date.now()}` });
    const actorId = jwt.decode(officerToken).id;
    const studentAwardId = await createApprovedVerifiedAward(student, actorId);
    const matchedAwardId = await createApprovedVerifiedAward(matchedStudent, actorId);

    const flagResult = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
       VALUES ($1, $2, $3, 'confirmed_duplicate')
       RETURNING *`,
      [student.id, matchedStudent.id, 0.79]
    );

    const response = await request(app)
      .post('/api/disbursements')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        award_id: studentAwardId,
        amount: 15000,
        payment_method: 'Test transfer',
      });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toMatch(/resolve duplicate review cases/i);

    const matchedStudentResponse = await request(app)
      .post('/api/disbursements')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ award_id: matchedAwardId, amount: 15000, payment_method: 'Test transfer' });

    expect(matchedStudentResponse.statusCode).toBe(409);
    expect(matchedStudentResponse.body.message).toMatch(/resolve duplicate review cases/i);

    await pool.query('DELETE FROM duplicate_flags WHERE id = $1', [flagResult.rows[0].id]);
    await pool.query('DELETE FROM bursary_awards WHERE id = ANY($1::uuid[])', [[studentAwardId, matchedAwardId]]);
    await pool.query('DELETE FROM students WHERE id = $1 OR id = $2', [student.id, matchedStudent.id]);
  });

  test('pending and further-verification flags block disbursement until resolved', async () => {
    const actorId = jwt.decode(officerToken).id;
    for (const status of ['pending', 'needs_verification']) {
      const student = await createStudent({ full_name: `Verification Student ${Date.now()}` });
      const matchedStudent = await createStudent({ full_name: `Verification Match ${Date.now()}` });
      const awardId = await createApprovedVerifiedAward(student, actorId);
      const flagResult = await pool.query(
        `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [student.id, matchedStudent.id, 0.2, status]
      );
      const response = await request(app)
        .post('/api/disbursements')
        .set('Authorization', `Bearer ${officerToken}`)
        .send({ award_id: awardId, amount: 1000, payment_method: 'Test transfer' });
      expect(response.statusCode).toBe(409);
      expect(response.body.message).toMatch(/resolve duplicate review cases/i);
      await pool.query('DELETE FROM duplicate_flags WHERE id = $1', [flagResult.rows[0].id]);
      await pool.query('DELETE FROM bursary_awards WHERE id = $1', [awardId]);
      await pool.query('DELETE FROM students WHERE id = $1 OR id = $2', [student.id, matchedStudent.id]);
    }
  });

  test('POST /api/disbursements should create a valid disbursement for a clean student', async () => {
    const student = await createStudent({ full_name: `Clean Student ${Date.now()}` });
    const awardId = await createApprovedVerifiedAward(student, jwt.decode(officerToken).id);

    const response = await request(app)
      .post('/api/disbursements')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        award_id: awardId,
        amount: 2500,
        payment_method: 'Test transfer',
        disbursement_date: '2026-09-10',
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.message).toMatch(/recorded as issued/i);
    expect(response.body.disbursement.student_id).toBe(student.id);
    expect(Number(response.body.disbursement.amount)).toBe(2500);

    await pool.query('DELETE FROM disbursement_reconciliation_events WHERE disbursement_id = $1', [response.body.disbursement.id]);
    await pool.query('DELETE FROM disbursements WHERE id = $1', [response.body.disbursement.id]);
    await pool.query('DELETE FROM bursary_awards WHERE id = $1', [awardId]);
    await pool.query('DELETE FROM students WHERE id = $1', [student.id]);
  });
});
