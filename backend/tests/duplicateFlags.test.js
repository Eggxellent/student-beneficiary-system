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
    national_id_number: null,
    birth_certificate_number: null,
    primary_phone: null,
    ...overrides,
  };

  const result = await pool.query(
    `INSERT INTO students
       (full_name, date_of_birth, school_code, guardian_id, upi,
        national_id_number, birth_certificate_number, primary_phone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [student.full_name, student.date_of_birth, student.school_code, student.guardian_id, student.upi,
      student.national_id_number, student.birth_certificate_number, student.primary_phone]
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

async function createSubmittedVerifiedAward(student, actorId) {
  const result = await pool.query(
    `INSERT INTO bursary_awards
       (student_id, school_code, requested_amount, status, verification_status,
        verification_notes, verification_evidence_ref, verified_by, verified_at, submitted_by)
     VALUES ($1, $2, 5000, 'submitted', 'verified', 'Isolated test fixture verified.',
        'test-fixture-evidence', $3, NOW(), $3)
     RETURNING id`,
    [student.id, student.school_code, actorId]
  );
  return result.rows[0].id;
}

describe('Duplicate flags and award API', () => {
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
      await pool.query('DELETE FROM bursary_award_verification_events WHERE actor_id = ANY($1::uuid[])', [createdUserIds]);
      await pool.query(
        `DELETE FROM bursary_awards
          WHERE submitted_by = ANY($1::uuid[])
             OR verified_by = ANY($1::uuid[])
             OR decided_by = ANY($1::uuid[])`,
        [createdUserIds]
      );
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

  test('GET /api/duplicate-flags/:id/identifiers reveals identifiers for verification and audits the reveal', async () => {
    const sharedUpi = `UPI-REVEAL-${Date.now()}`;
    const sharedCertificate = `BC-REVEAL-${Date.now()}`;
    const student = await createStudent({
      full_name: `Reveal Flag ${Date.now()}`,
      upi: sharedUpi,
      birth_certificate_number: sharedCertificate,
      national_id_number: 'NID-REVEAL-001',
      primary_phone: '+254712345678',
    });
    const matchedStudent = await createStudent({
      full_name: `Reveal Match ${Date.now()}`,
      upi: `${sharedUpi}-B`,
      birth_certificate_number: `${sharedCertificate}-B`,
      national_id_number: 'NID-REVEAL-002',
      primary_phone: '+254712345679',
    });
    const flagResult = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
       VALUES ($1, $2, $3, 'pending')
       RETURNING *`,
      [student.id, matchedStudent.id, 0.94]
    );
    const caseId = flagResult.rows[0].id;

    // The queue keeps identifiers masked, so a queued case cannot be screenshotted into a leak.
    const queue = await request(app)
      .get('/api/duplicate-flags?status=pending')
      .set('Authorization', `Bearer ${adminToken}`);
    const queuedCase = queue.body.cases.find((flag) => flag.id === caseId);
    expect(queuedCase.students[0].upi).not.toBe(sharedUpi);
    expect(queuedCase.students[0].guardian_contact).not.toBe('+254712345678');
    expect(queuedCase.students[0].guardian_contact).toMatch(/678$/);
    expect(queuedCase.students[0].guardian_contact).not.toContain('254712345678');

    const officerReveal = await request(app)
      .get(`/api/duplicate-flags/${caseId}/identifiers`)
      .set('Authorization', `Bearer ${officerToken}`);
    expect(officerReveal.statusCode).toBe(403);

    const reveal = await request(app)
      .get(`/api/duplicate-flags/${caseId}/identifiers`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(reveal.statusCode).toBe(200);
    expect(reveal.body.students[0].upi).toBe(sharedUpi);
    expect(reveal.body.students[0].birth_certificate_number).toBe(sharedCertificate);
    expect(reveal.body.students[0].national_id_number).toBe('NID-REVEAL-001');
    expect(reveal.body.students[0].guardian_contact).toBe('+254712345678');
    expect(reveal.body.students[1].upi).toBe(`${sharedUpi}-B`);

    const revealAudit = await pool.query(
      "SELECT user_id, details FROM audit_logs WHERE record_id = $1 AND action = 'REVEAL_DUPLICATE_IDENTIFIERS' ORDER BY created_at DESC LIMIT 1",
      [caseId]
    );
    expect(revealAudit.rows[0].user_id).toBe(jwt.decode(adminToken).id);
    expect(revealAudit.rows[0].details.fields).toContain('upi');
    expect(revealAudit.rows[0].details.fields).toContain('guardian_contact');

    const missingCase = await request(app)
      .get('/api/duplicate-flags/00000000-0000-4000-8000-000000000000/identifiers')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(missingCase.statusCode).toBe(404);

    await pool.query('DELETE FROM duplicate_flags WHERE id = $1', [caseId]);
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

  test('award approval is blocked after a reviewer confirms a duplicate', async () => {
    const student = await createStudent({ full_name: `Award Block ${Date.now()}` });
    const matchedStudent = await createStudent({ full_name: `Award Block Match ${Date.now()}` });
    const officerId = jwt.decode(officerToken).id;
    const awardId = await createSubmittedVerifiedAward(student, officerId);
    const matchedAwardId = await createSubmittedVerifiedAward(matchedStudent, officerId);

    const flagResult = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status, resolved_by, resolved_at)
       VALUES ($1, $2, 0.93, 'confirmed_duplicate', $3, NOW())
       RETURNING id`,
      [student.id, matchedStudent.id, jwt.decode(adminToken).id]
    );

    for (const id of [awardId, matchedAwardId]) {
      const response = await request(app)
        .patch(`/api/awards/${id}/decision`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ decision: 'approved', approved_amount: 5000, reason: 'Attempted approval despite a confirmed duplicate.' });
      expect(response.statusCode).toBe(409);
      expect(response.body.message).toMatch(/resolve duplicate review cases/i);
    }

    const stored = await pool.query(
      'SELECT status FROM bursary_awards WHERE id = ANY($1::uuid[])',
      [[awardId, matchedAwardId]]
    );
    expect(stored.rows.every((row) => row.status === 'submitted')).toBe(true);

    await pool.query('DELETE FROM duplicate_flags WHERE id = $1', [flagResult.rows[0].id]);
    await pool.query('DELETE FROM bursary_awards WHERE id = ANY($1::uuid[])', [[awardId, matchedAwardId]]);
    await pool.query('DELETE FROM students WHERE id = $1 OR id = $2', [student.id, matchedStudent.id]);
  });

  test('pending and further-verification flags block award approval until resolved', async () => {
    const student = await createStudent({ full_name: `Award Pending ${Date.now()}` });
    const matchedStudent = await createStudent({ full_name: `Award Pending Match ${Date.now()}` });
    const officerId = jwt.decode(officerToken).id;
    const awardId = await createSubmittedVerifiedAward(student, officerId);

    const flagResult = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
       VALUES ($1, $2, 0.78, 'pending')
       RETURNING id`,
      [student.id, matchedStudent.id]
    );

    const pendingResponse = await request(app)
      .patch(`/api/awards/${awardId}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved', approved_amount: 5000, reason: 'Attempted approval while a case is pending.' });
    expect(pendingResponse.statusCode).toBe(409);
    expect(pendingResponse.body.message).toMatch(/resolve duplicate review cases/i);

    const escalated = await request(app)
      .patch(`/api/duplicate-flags/${flagResult.rows[0].id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'needs_verification', reason: 'The school must confirm the guardian record.' });
    expect(escalated.statusCode).toBe(200);
    expect(escalated.body.flag.status).toBe('needs_verification');

    const verifyingResponse = await request(app)
      .patch(`/api/awards/${awardId}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved', approved_amount: 5000, reason: 'Attempted approval during further verification.' });
    expect(verifyingResponse.statusCode).toBe(409);
    expect(verifyingResponse.body.message).toMatch(/resolve duplicate review cases/i);

    await pool.query('DELETE FROM duplicate_review_events WHERE duplicate_flag_id = $1', [flagResult.rows[0].id]);
    await pool.query('DELETE FROM duplicate_flags WHERE id = $1', [flagResult.rows[0].id]);
    await pool.query('DELETE FROM bursary_awards WHERE id = $1', [awardId]);
    await pool.query('DELETE FROM students WHERE id = $1 OR id = $2', [student.id, matchedStudent.id]);
  });

  test('a verified award for a student with no open duplicate case can be approved', async () => {
    const student = await createStudent({ full_name: `Award Clean ${Date.now()}` });
    const officerId = jwt.decode(officerToken).id;
    const awardId = await createSubmittedVerifiedAward(student, officerId);

    const response = await request(app)
      .patch(`/api/awards/${awardId}/decision`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'approved', approved_amount: 4500, reason: 'Verified award, no open duplicate cases.' });
    expect(response.statusCode).toBe(200);

    const stored = await pool.query(
      'SELECT status, approved_amount FROM bursary_awards WHERE id = $1',
      [awardId]
    );
    expect(stored.rows[0].status).toBe('approved');
    expect(Number(stored.rows[0].approved_amount)).toBe(4500);

    await pool.query('DELETE FROM bursary_awards WHERE id = $1', [awardId]);
    await pool.query('DELETE FROM students WHERE id = $1', [student.id]);
  });
});

