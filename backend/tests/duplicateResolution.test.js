const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../src/index');
const pool = require('../src/config/db');

// Confirming a duplicate is only a review decision. These tests cover the administrator-only
// resolution that names a canonical record, marks the other record as its duplicate, keeps both
// records, and still blocks the duplicate from receiving a bursary.
describe('administrator duplicate resolution', () => {
  jest.setTimeout(180000);

  const created = { users: [], students: [], flags: [] };
  let admin;
  let officer;

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

  async function createPair(label) {
    const first = await createStudent(`${label} First`);
    const second = await createStudent(`${label} Second`);
    return { first, second };
  }

  async function confirmPair(pair) {
    const { rows } = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status, model_version, review_threshold)
       VALUES ($1, $2, 0.99, 'confirmed_duplicate', 'test-model', 0.5) RETURNING id`,
      [pair.first.id, pair.second.id]
    );
    created.flags.push(rows[0].id);
    return rows[0].id;
  }

  async function createCase(label) {
    const pair = await createPair(label);
    const flagId = await confirmPair(pair);
    return { ...pair, flagId };
  }

  const auth = (actor) => ({ Authorization: `Bearer ${actor.token}` });

  const propose = (studentId, amount = 20000) => request(app)
    .post('/api/awards')
    .set(auth(officer))
    .send({ student_id: studentId, requested_amount: amount });

  const decide = (awardId, amount = 20000) => request(app)
    .patch(`/api/awards/${awardId}/decision`)
    .set(auth(admin))
    .send({ decision: 'approved', approved_amount: amount, reason: 'Verified against the school records' });

  const resolve = (flagId, canonicalStudentId, reason = 'Birth certificate and National ID confirm the same student') => request(app)
    .post(`/api/duplicate-flags/${flagId}/resolution`)
    .set(auth(admin))
    .send({ canonical_student_id: canonicalStudentId, reason });

  beforeAll(async () => {
    admin = await createUser('admin', 'Resolution Admin');
    officer = await createUser('field_officer', 'Resolution Officer');
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
      await attempt('award cleanup', () => pool.query('DELETE FROM bursary_awards WHERE student_id = ANY($1::uuid[])', [created.students]));
    }
    if (created.flags.length) {
      await attempt('resolution cleanup', () => pool.query('DELETE FROM duplicate_resolutions WHERE duplicate_flag_id = ANY($1::uuid[])', [created.flags]));
      await attempt('review event cleanup', () => pool.query('DELETE FROM duplicate_review_events WHERE duplicate_flag_id = ANY($1::uuid[])', [created.flags]));
      await attempt('flag cleanup', () => pool.query('DELETE FROM duplicate_flags WHERE id = ANY($1::uuid[])', [created.flags]));
    }
    if (created.students.length) {
      await attempt('duplicate link cleanup', () => pool.query(
        `UPDATE students SET duplicate_of_student_id = NULL, duplicate_marked_at = NULL, duplicate_marked_by = NULL
         WHERE id = ANY($1::uuid[])`,
        [created.students]
      ));
      await attempt('student cleanup', () => pool.query('DELETE FROM students WHERE id = ANY($1::uuid[])', [created.students]));
    }
    if (created.users.length) {
      await attempt('audit user cleanup', () => pool.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [created.users]));
      await attempt('user cleanup', () => pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [created.users]));
    }
    await attempt('pool shutdown', () => pool.end());
    if (failures.length) throw new Error(`Cleanup failed: ${failures.join(', ')}`);
  });

  test('an unresolved confirmed duplicate blocks award approval for both records', async () => {
    const pair = await createPair('Unresolved');
    const proposal = await propose(pair.first.id, 20000);
    expect(proposal.statusCode).toBe(201);
    const flagId = await confirmPair(pair);

    const blocked = await decide(proposal.body.award.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.body.message).toMatch(/Resolve duplicate review cases/);
  });

  test('a field officer cannot resolve a duplicate case', async () => {
    const pair = await createCase('Officer Denied');
    const response = await request(app)
      .post(`/api/duplicate-flags/${pair.flagId}/resolution`)
      .set(auth(officer))
      .send({ canonical_student_id: pair.first.id, reason: 'Trying to resolve without authority' });
    expect(response.statusCode).toBe(403);

    const student = await pool.query('SELECT duplicate_of_student_id FROM students WHERE id = $1', [pair.second.id]);
    expect(student.rows[0].duplicate_of_student_id).toBeNull();
  });

  test('the canonical record must be one of the two records in the case, and a reason is required', async () => {
    const pair = await createCase('Validation');
    const outsider = await createStudent('Validation Outsider');

    const unrelated = await resolve(pair.flagId, outsider.id);
    expect(unrelated.statusCode).toBe(400);

    const shortReason = await request(app)
      .post(`/api/duplicate-flags/${pair.flagId}/resolution`)
      .set(auth(admin))
      .send({ canonical_student_id: pair.first.id, reason: 'no' });
    expect(shortReason.statusCode).toBe(400);

    const missingReason = await request(app)
      .post(`/api/duplicate-flags/${pair.flagId}/resolution`)
      .set(auth(admin))
      .send({ canonical_student_id: pair.first.id });
    expect(missingReason.statusCode).toBe(400);
  });

  test('resolution marks the chosen duplicate, keeps both records, and writes an audit entry', async () => {
    const pair = await createCase('Resolved');
    const response = await resolve(pair.flagId, pair.first.id);
    expect(response.statusCode).toBe(201);
    expect(response.body.canonical_student.id).toBe(pair.first.id);
    expect(response.body.duplicate_student.id).toBe(pair.second.id);

    const students = await pool.query(
      'SELECT id, duplicate_of_student_id, duplicate_marked_by FROM students WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[pair.first.id, pair.second.id]]
    );
    const canonical = students.rows.find((row) => row.id === pair.first.id);
    const duplicate = students.rows.find((row) => row.id === pair.second.id);
    expect(canonical.duplicate_of_student_id).toBeNull();
    expect(duplicate.duplicate_of_student_id).toBe(pair.first.id);
    expect(duplicate.duplicate_marked_by).toBe(admin.id);

    const resolution = await pool.query('SELECT * FROM duplicate_resolutions WHERE duplicate_flag_id = $1', [pair.flagId]);
    expect(resolution.rows).toHaveLength(1);
    expect(resolution.rows[0].reason).toMatch(/Birth certificate/);

    const audit = await pool.query(
      "SELECT details FROM audit_logs WHERE action = 'DUPLICATE_CASE_RESOLVED' AND record_id = $1",
      [pair.flagId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].details.canonical_student_id).toBe(pair.first.id);
    expect(audit.rows[0].details.duplicate_student_id).toBe(pair.second.id);
  });

  test('a case cannot be resolved twice and the opposite direction is rejected', async () => {
    const pair = await createCase('Repeated');
    expect((await resolve(pair.flagId, pair.second.id)).statusCode).toBe(201);
    expect((await resolve(pair.flagId, pair.first.id)).statusCode).toBe(409);
    expect((await resolve(pair.flagId, pair.second.id)).statusCode).toBe(409);

    const rows = await pool.query('SELECT * FROM duplicate_resolutions WHERE duplicate_flag_id = $1', [pair.flagId]);
    expect(rows.rows).toHaveLength(1);
  });

  test('after resolution the canonical record can be approved, the duplicate cannot', async () => {
    const pair = await createCase('Canonical Proceeds');
    expect((await resolve(pair.flagId, pair.first.id)).statusCode).toBe(201);

    const canonicalProposal = await propose(pair.first.id, 20000);
    expect(canonicalProposal.statusCode).toBe(201);
    const approved = await decide(canonicalProposal.body.award.id);
    expect(approved.statusCode).toBe(200);
    expect(approved.body.certificate_reference).toBeTruthy();

    const duplicateProposal = await propose(pair.second.id, 20000);
    expect(duplicateProposal.statusCode).toBe(409);
    expect(duplicateProposal.body.code).toBe('DUPLICATE_RECORD');
  });

  test('an award already attached to the duplicate record stays attached and blocked', async () => {
    const pair = await createPair('Existing Award');
    const duplicateProposal = await propose(pair.second.id, 20000);
    expect(duplicateProposal.statusCode).toBe(201);
    const flagId = await confirmPair(pair);

    const resolved = await resolve(flagId, pair.first.id);
    expect(resolved.statusCode).toBe(201);
    expect(resolved.body.duplicate_open_awards).toHaveLength(1);

    const stillBlocked = await decide(duplicateProposal.body.award.id);
    expect(stillBlocked.statusCode).toBe(409);
    expect(stillBlocked.body.code).toBe('DUPLICATE_RECORD');

    const award = await pool.query('SELECT student_id, status FROM bursary_awards WHERE id = $1', [duplicateProposal.body.award.id]);
    expect(award.rows[0].student_id).toBe(pair.second.id);
    expect(award.rows[0].status).toBe('submitted');
  });

  test('the annual rule spans the resolved records', async () => {
    const pair = await createPair('Annual Span');
    const duplicateProposal = await propose(pair.second.id, 20000);
    expect(duplicateProposal.statusCode).toBe(201);
    const flagId = await confirmPair(pair);
    expect((await resolve(flagId, pair.first.id)).statusCode).toBe(201);

    const canonicalProposal = await propose(pair.first.id, 25000);
    expect(canonicalProposal.statusCode).toBe(409);
    expect(canonicalProposal.body.code).toBe('ANNUAL_AWARD_EXISTS');
  });

  test('two simultaneous resolutions of the same case cannot both succeed', async () => {
    const pair = await createCase('Concurrent');
    const responses = await Promise.all([
      resolve(pair.flagId, pair.first.id),
      resolve(pair.flagId, pair.second.id),
    ]);
    const statuses = responses.map((response) => response.statusCode).sort();
    expect(statuses).toEqual([201, 409]);

    const resolutions = await pool.query('SELECT * FROM duplicate_resolutions WHERE duplicate_flag_id = $1', [pair.flagId]);
    expect(resolutions.rows).toHaveLength(1);
    const marked = await pool.query(
      'SELECT COUNT(*)::int AS count FROM students WHERE id = ANY($1::uuid[]) AND duplicate_of_student_id IS NOT NULL',
      [[pair.first.id, pair.second.id]]
    );
    expect(marked.rows[0].count).toBe(1);
  });


});
