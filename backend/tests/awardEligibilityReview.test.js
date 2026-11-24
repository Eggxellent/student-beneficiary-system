const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../src/index');
const pool = require('../src/config/db');

// Proof that the administrator's decision screen reads the assessment the field officer actually
// saved, for the right student, without recalculating anything.
describe('administrator award review shows the saved eligibility assessment', () => {
  jest.setTimeout(180000);

  const created = { users: [], students: [] };
  let admin;
  let officer;
  const year = new Date().getUTCFullYear();

  async function createUser(role, label) {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`.toLowerCase();
    const password_hash = await bcrypt.hash('TestPassword123!', 4);
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

  const assess = (studentId, overrides = {}) => request(app)
    .post('/api/eligibility')
    .set(auth(officer))
    .send({
      student_id: studentId,
      fee_balance: 45000,
      household_income: 18000,
      vulnerability_status: 'low',
      siblings_in_school: 2,
      prior_bursary_history: 'none',
      ...overrides,
    });

  const propose = (studentId, amount = 20000) => request(app)
    .post('/api/awards')
    .set(auth(officer))
    .send({ student_id: studentId, requested_amount: amount });

  const review = (awardId) => request(app).get(`/api/awards/${awardId}`).set(auth(admin));

  beforeAll(async () => {
    admin = await createUser('admin', 'Eligibility Review Admin');
    officer = await createUser('field_officer', 'Eligibility Review Officer');
  });

  afterAll(async () => {
    const failures = [];
    const attempt = async (label, operation) => {
      try { await operation(); } catch { failures.push(label); }
    };
    if (created.students.length) {
      const awards = await pool.query('SELECT id FROM bursary_awards WHERE student_id = ANY($1::uuid[])', [created.students]);
      const awardIds = awards.rows.map((row) => row.id);
      if (awardIds.length) {
        await attempt('audit cleanup', () => pool.query('DELETE FROM audit_logs WHERE record_id = ANY($1::uuid[])', [awardIds]));
        await attempt('certificate cleanup', () => pool.query('DELETE FROM bursary_certificates WHERE award_id = ANY($1::uuid[])', [awardIds]));
      }
      await attempt('assessment cleanup', () => pool.query('DELETE FROM eligibility_assessments WHERE student_id = ANY($1::uuid[])', [created.students]));
      await attempt('award cleanup', () => pool.query('DELETE FROM bursary_awards WHERE student_id = ANY($1::uuid[])', [created.students]));
      await attempt('student cleanup', () => pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [created.students]));
    }
    if (created.users.length) {
      await attempt('audit user cleanup', () => pool.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [created.users]));
      await attempt('user cleanup', () => pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [created.users]));
    }
    await attempt('pool shutdown', () => pool.end());
    if (failures.length) throw new Error(`Cleanup failed: ${failures.join(', ')}`);
  });

  test('the saved assessment is returned for the correct student and matches what was calculated', async () => {
    const student = await createStudent('Review Saved Assessment');
    const assessed = await assess(student.id);
    expect(assessed.statusCode).toBe(200);
    expect(assessed.body.score).toBe(72);

    const proposal = await propose(student.id, 20000);
    expect(proposal.statusCode).toBe(201);

    const response = await review(proposal.body.award.id);
    expect(response.statusCode).toBe(200);
    expect(response.body.student.id).toBe(student.id);
    expect(response.body.student.upi).toBe(student.upi);
    expect(response.body.eligibility).toMatchObject({
      score: 72,
      category: 'high',
      fee_balance: 45000,
      household_income: 18000,
      vulnerability_status: 'low',
      siblings_in_school: 2,
      prior_bursary_history: 'none',
    });
    expect(response.body.eligibility.recommended_range.provisional).toBe(true);
    expect(response.body.eligibility.assessed_at).toBeTruthy();

    const stored = await pool.query(
      'SELECT score, fee_balance, household_income FROM eligibility_assessments WHERE student_id = $1',
      [student.id]
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].score).toBe(72);
    expect(Number(stored.rows[0].fee_balance)).toBe(45000);
  });

  test('two students never share an assessment in the review response', async () => {
    const first = await createStudent('Review First Student');
    const second = await createStudent('Review Second Student');
    await assess(first.id);
    await assess(second.id, { fee_balance: 5000, household_income: 70000, vulnerability_status: 'medium', siblings_in_school: 0, prior_bursary_history: 'high' });

    const firstProposal = await propose(first.id, 20000);
    const secondProposal = await propose(second.id, 9000);
    const firstReview = await review(firstProposal.body.award.id);
    const secondReview = await review(secondProposal.body.award.id);

    expect(firstReview.body.student.id).toBe(first.id);
    expect(secondReview.body.student.id).toBe(second.id);
    expect(firstReview.body.eligibility.score).toBe(72);
    expect(secondReview.body.eligibility.fee_balance).toBe(5000);
    expect(secondReview.body.eligibility.prior_bursary_history).toBe('high');
  });

  test('a student with no saved assessment is reported as missing, not invented', async () => {
    const student = await createStudent('Review No Assessment');
    const proposal = await propose(student.id, 15000);
    expect(proposal.statusCode).toBe(201);

    const response = await review(proposal.body.award.id);
    expect(response.statusCode).toBe(200);
    expect(response.body.eligibility).toBeNull();
    expect(response.body.student.full_name).toBe(student.full_name);
  });

  test('the administrator can approve an amount that differs from the proposal and recommendation', async () => {
    const student = await createStudent('Review Different Amount');
    await assess(student.id);
    const proposal = await propose(student.id, 20000);

    const decision = await request(app)
      .patch(`/api/awards/${proposal.body.award.id}/decision`)
      .set(auth(admin))
      .send({ decision: 'approved', approved_amount: 17500, reason: 'Reviewed the assessment and reduced the award' });

    expect(decision.statusCode).toBe(200);
    expect(Number(decision.body.award.approved_amount)).toBe(17500);
    expect(decision.body.award.status).toBe('approved');
    expect(decision.body.certificate_reference).toBeTruthy();
    expect(decision.body.award.award_year).toBe(year);
  });

  test('a field officer cannot read the administrator review detail', async () => {
    const student = await createStudent('Review Officer Access');
    await assess(student.id);
    const proposal = await propose(student.id, 12000);

    const response = await request(app)
      .get(`/api/awards/${proposal.body.award.id}`)
      .set(auth(officer));
    expect(response.statusCode).toBe(403);
  });

  test('an incomplete assessment recorded later does not replace the completed one under review', async () => {
    const student = await createStudent('Review Complete Then Incomplete');
    await assess(student.id);
    await pool.query(
      `INSERT INTO eligibility_assessments
         (student_id, status, missing_inputs, trigger, trigger_reference, recorded_via, assessed_at)
       VALUES ($1, 'incomplete', ARRAY['fee_balance']::text[], 'registration_screening', gen_random_uuid(),
               'automatic_assessment', NOW() + INTERVAL '1 minute')`,
      [student.id]
    );

    const proposal = await propose(student.id, 20000);
    expect(proposal.statusCode).toBe(201);

    const response = await review(proposal.body.award.id);
    expect(response.statusCode).toBe(200);
    expect(response.body.eligibility).toMatchObject({
      score: 72,
      category: 'high',
      fee_balance: 45000,
      household_income: 18000,
    });
  });

  test('financial fields the completed assessment never recorded are null, not zero', async () => {
    const student = await createStudent('Review Unknown Financials');
    // A completed assessment can still lack optional monetary inputs; the review must say "not
    // recorded" instead of presenting a confident KSh 0 the officer never entered.
    await pool.query(
      `INSERT INTO eligibility_assessments (student_id, score, category, fee_balance, household_income, status, recorded_via)
       VALUES ($1, 50, 'moderate', NULL, NULL, 'complete', 'eligibility_form')`,
      [student.id]
    );

    const proposal = await propose(student.id, 10000);
    expect(proposal.statusCode).toBe(201);

    const response = await review(proposal.body.award.id);
    expect(response.statusCode).toBe(200);
    expect(response.body.eligibility.score).toBe(50);
    expect(response.body.eligibility.fee_balance).toBeNull();
    expect(response.body.eligibility.household_income).toBeNull();
  });

});

