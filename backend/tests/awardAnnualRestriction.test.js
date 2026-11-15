const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../src/index');
const pool = require('../src/config/db');

// Database-backed proof of the annual rule: the unique index, the concurrency behaviour, and the
// report -> correct/void path. Students are inserted directly so the suite does not depend on the
// ML screening service that registration calls.
describe('one bursary per student per calendar year', () => {
  jest.setTimeout(180000);

  const created = { users: [], students: [] };
  const password = 'TestPassword123!';
  let admin;
  let officer;
  let otherOfficer;
  const year = new Date().getUTCFullYear();

  async function createUser(role, label) {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`.toLowerCase();
    const password_hash = await bcrypt.hash(password, 4);
    const { rows } = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id',
      [label, email, password_hash, role]
    );
    created.users.push(rows[0].id);
    return {
      id: rows[0].id,
      token: jwt.sign({ id: rows[0].id, role }, process.env.JWT_SECRET, { expiresIn: '8h' }),
    };
  }

  async function createStudent(label) {
    const { rows } = await pool.query(
      `INSERT INTO students (full_name, school_code, upi, national_id_number)
       VALUES ($1, 'Nairobi School', $2, $3) RETURNING id, full_name, upi`,
      [label, `UPI-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, `NID-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`]
    );
    created.students.push(rows[0].id);
    return rows[0];
  }

  const auth = (actor) => ({ Authorization: `Bearer ${actor.token}` });

  const propose = (studentId, amount = 20000, actor = officer) => request(app)
    .post('/api/awards')
    .set(auth(actor))
    .send({ student_id: studentId, requested_amount: amount });

  async function proposeAndApprove(studentId, amount = 20000) {
    const proposal = await propose(studentId, amount);
    expect(proposal.statusCode).toBe(201);
    const approved = await request(app)
      .patch(`/api/awards/${proposal.body.award.id}/decision`)
      .set(auth(admin))
      .send({ decision: 'approved', approved_amount: amount, reason: 'Verified against the school records' });
    expect(approved.statusCode).toBe(200);
    return proposal.body.award.id;
  }

  beforeAll(async () => {
    admin = await createUser('admin', 'Annual Rule Admin');
    officer = await createUser('field_officer', 'Annual Rule Officer');
    otherOfficer = await createUser('field_officer', 'Annual Rule Other Officer');
  });

  afterAll(async () => {
    const failures = [];
    const attempt = async (label, operation) => {
      try { await operation(); } catch { failures.push(label); }
    };
    const studentIds = created.students;
    if (studentIds.length) {
      const awards = await pool.query('SELECT id FROM bursary_awards WHERE student_id = ANY($1::uuid[])', [studentIds]);
      const awardIds = awards.rows.map((row) => row.id);
      if (awardIds.length) {
        await attempt('event cleanup', () => pool.query(
          'DELETE FROM bursary_award_correction_events WHERE award_id = ANY($1::uuid[])', [awardIds]
        ));
        await attempt('audit cleanup', () => pool.query(
          'DELETE FROM audit_logs WHERE record_id = ANY($1::uuid[])', [awardIds]
        ));
        await attempt('certificate cleanup', () => pool.query(
          'DELETE FROM bursary_certificates WHERE award_id = ANY($1::uuid[])', [awardIds]
        ));
      }
      await attempt('award cleanup', () => pool.query(
        'DELETE FROM bursary_awards WHERE student_id = ANY($1::uuid[])', [studentIds]
      ));
      await attempt('student cleanup', () => pool.query(
        'DELETE FROM students WHERE id = ANY($1::uuid[])', [studentIds]
      ));
    }
    if (created.users.length) {
      await attempt('audit user cleanup', () => pool.query(
        'DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [created.users]
      ));
      await attempt('user cleanup', () => pool.query(
        'DELETE FROM users WHERE id = ANY($1::uuid[])', [created.users]
      ));
    }
    await attempt('pool shutdown', () => pool.end());
    if (failures.length) throw new Error(`Cleanup failed: ${failures.join(', ')}`);
  });


  test('a pending proposal blocks another proposal for the same student and year', async () => {
    const student = await createStudent('Annual Rule Pending');

    const first = await propose(student.id);
    expect(first.statusCode).toBe(201);
    expect(first.body.award.award_year).toBe(year);

    const second = await propose(student.id, 30000, otherOfficer);
    expect(second.statusCode).toBe(409);
    expect(second.body.code).toBe('ANNUAL_AWARD_EXISTS');
    expect(second.body.message).toMatch(/one bursary per calendar year/i);

    // The list the page reads carries the year and the open-report columns the forms use.
    const listing = await request(app).get('/api/awards').set(auth(admin));
    expect(listing.statusCode).toBe(200);
    const listed = listing.body.awards.find((award) => award.id === first.body.award.id);
    expect(listed.award_year).toBe(year);
    expect(listed.open_report_id).toBeNull();
  });

  test('two simultaneous submissions cannot both succeed', async () => {
    const student = await createStudent('Annual Rule Concurrent');

    const responses = await Promise.all([
      propose(student.id, 20000, officer),
      propose(student.id, 21000, otherOfficer),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const refused = responses.find((response) => response.statusCode === 409);
    expect(refused.body.code).toBe('ANNUAL_AWARD_EXISTS');

    const rows = await pool.query(
      `SELECT status FROM bursary_awards
       WHERE student_id = $1 AND award_year = $2 AND status IN ('submitted', 'approved')`,
      [student.id, year]
    );
    expect(rows.rows).toHaveLength(1);
  });

  test('voiding needs an administrator, a report and a reason, then restores eligibility', async () => {
    const student = await createStudent('Annual Rule Void');
    const awardId = await proposeAndApprove(student.id, 30000);

    // The approved award occupies the year.
    expect((await propose(student.id, 15000)).statusCode).toBe(409);

    // A field officer cannot void, even their own award.
    const officerVoid = await request(app)
      .post(`/api/awards/${awardId}/void`)
      .set(auth(officer))
      .send({ reason: 'The amount is wrong' });
    expect(officerVoid.statusCode).toBe(403);

    // An administrator cannot void before the error is reported.
    const earlyVoid = await request(app)
      .post(`/api/awards/${awardId}/void`)
      .set(auth(admin))
      .send({ reason: 'The amount is wrong' });
    expect(earlyVoid.statusCode).toBe(409);
    expect(earlyVoid.body.message).toMatch(/no error report/i);

    // The proposing officer reports the mistake.
    const report = await request(app)
      .post(`/api/awards/${awardId}/error-report`)
      .set(auth(officer))
      .send({ reason: 'The approved amount was entered incorrectly' });
    expect(report.statusCode).toBe(201);
    expect((await propose(student.id, 15000)).statusCode).toBe(409);

    // Voiding without a real reason is refused.
    const noReason = await request(app)
      .post(`/api/awards/${awardId}/void`)
      .set(auth(admin))
      .send({ reason: 'oops' });
    expect(noReason.statusCode).toBe(400);

    const voided = await request(app)
      .post(`/api/awards/${awardId}/void`)
      .set(auth(admin))
      .send({ reason: 'Awarded to the wrong student record' });
    expect(voided.statusCode).toBe(200);
    expect(voided.body.award.status).toBe('voided');

    // The original row is kept with its reason and actor.
    const preserved = await pool.query(
      'SELECT status, void_reason, voided_by FROM bursary_awards WHERE id = $1',
      [awardId]
    );
    expect(preserved.rows[0].status).toBe('voided');
    expect(preserved.rows[0].void_reason).toBe('Awarded to the wrong student record');
    expect(preserved.rows[0].voided_by).toBe(admin.id);

    // Eligibility is restored only now.
    const replacement = await propose(student.id, 15000);
    expect(replacement.statusCode).toBe(201);
    const replacementApproved = await request(app)
      .patch(`/api/awards/${replacement.body.award.id}/decision`)
      .set(auth(admin))
      .send({ decision: 'approved', approved_amount: 15000, reason: 'Corrected award for the same learner' });
    expect(replacementApproved.statusCode).toBe(200);
  });

  test('a correction keeps the year occupied and preserves the original values', async () => {
    const student = await createStudent('Annual Rule Correct');
    const awardId = await proposeAndApprove(student.id, 20000);

    const report = await request(app)
      .post(`/api/awards/${awardId}/error-report`)
      .set(auth(officer))
      .send({ reason: 'The approved amount should be 25000' });
    expect(report.statusCode).toBe(201);

    const corrected = await request(app)
      .patch(`/api/awards/${awardId}/correction`)
      .set(auth(admin))
      .send({ approved_amount: 25000, reason: 'School records confirmed 25000' });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.body.award.status).toBe('approved');
    expect(corrected.body.changes.approved_amount).toEqual({ from: 20000, to: 25000 });

    // The corrected award still consumes the year.
    const blocked = await propose(student.id, 10000);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.code).toBe('ANNUAL_AWARD_EXISTS');

    const events = await pool.query(
      `SELECT event_type, reason, changes, actor_id FROM bursary_award_correction_events
       WHERE award_id = $1 ORDER BY created_at`,
      [awardId]
    );
    expect(events.rows.map((row) => row.event_type)).toEqual(['error_reported', 'award_corrected']);
    expect(events.rows[1].changes).toEqual({ approved_amount: { from: 20000, to: 25000 } });
    expect(events.rows[0].actor_id).toBe(officer.id);
    expect(events.rows[1].actor_id).toBe(admin.id);

    const awards = await pool.query('SELECT COUNT(*)::int AS count FROM bursary_awards WHERE student_id = $1', [student.id]);
    expect(awards.rows[0].count).toBe(1);

    const audit = await pool.query(
      "SELECT action, user_id FROM audit_logs WHERE record_id = $1 AND action IN ('AWARD_ERROR_REPORTED', 'AWARD_CORRECTED') ORDER BY created_at",
      [awardId]
    );
    expect(audit.rows).toEqual([
      { action: 'AWARD_ERROR_REPORTED', user_id: officer.id },
      { action: 'AWARD_CORRECTED', user_id: admin.id },
    ]);
  });

  test('a new calendar year is not blocked by last year\'s award', async () => {
    const student = await createStudent('Annual Rule New Year');
    const previous = await pool.query(
      `INSERT INTO bursary_awards
         (student_id, school_code, requested_amount, approved_amount, status, award_year,
          decision_reason, decided_by, decided_at, submitted_by, created_at, updated_at)
       VALUES ($1, 'Nairobi School', 18000, 18000, 'approved', $2,
               'Awarded in the previous calendar year', $3, NOW() - INTERVAL '1 year', $4,
               NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 year')
       RETURNING id, award_year`,
      [student.id, year - 1, admin.id, officer.id]
    );
    expect(previous.rows[0].award_year).toBe(year - 1);

    const proposal = await propose(student.id, 20000);
    expect(proposal.statusCode).toBe(201);
    expect(proposal.body.award.award_year).toBe(year);
  });

  test('an officer can only report an award they proposed', async () => {
    const student = await createStudent('Annual Rule Ownership');
    const awardId = await proposeAndApprove(student.id, 12000);

    const foreign = await request(app)
      .post(`/api/awards/${awardId}/error-report`)
      .set(auth(otherOfficer))
      .send({ reason: 'The amount looks wrong to me' });
    expect(foreign.statusCode).toBe(403);
  });
});
