const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../src/index");
const pool = require("../src/config/db");

describe("Disbursements API", () => {
  jest.setTimeout(30000);
  let token;
  let studentId;
  let matchedStudentId;
  let awardId;
  let userId;

  beforeAll(async () => {
    const email = `disbursementtest${Date.now()}@example.com`;
    const password = "TestPassword123!";
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'field_officer') RETURNING id",
      ["Disbursement Test Field Officer", email, passwordHash]
    );
    userId = account.rows[0].id;

    const loginResponse = await request(app)
      .post("/api/auth/login/field-officer")
      .send({
        email,
        password,
      });

    token = loginResponse.body.token;

    const student = await pool.query(
      `INSERT INTO students (full_name, school_code, guardian_id, upi)
       VALUES ($1, 'Nairobi School', $2, $3) RETURNING id`,
      [`Disbursement Test Student ${Date.now()}`, `GUARD-${Date.now()}`, `UPI-TEST-${Date.now()}`]
    );
    studentId = student.rows[0].id;

    const award = await pool.query(
      `INSERT INTO bursary_awards
         (student_id, school_code, requested_amount, status, verification_status,
          verification_notes, verification_evidence_ref, verified_by, verified_at,
          approved_amount, decision_reason, decided_by, decided_at, submitted_by)
       VALUES ($1, 'Nairobi School', 5000, 'approved', 'verified',
          'Isolated test fixture verified.', 'test-fixture-evidence', $2, NOW(),
          5000, 'Approved isolated test fixture.', $2, NOW(), $2)
       RETURNING id`,
      [studentId, userId]
    );
    awardId = award.rows[0].id;
  });

  afterAll(async () => {
    if (awardId) {
      await pool.query('DELETE FROM disbursement_reconciliation_events WHERE disbursement_id IN (SELECT id FROM disbursements WHERE award_id = $1)', [awardId]);
      await pool.query('DELETE FROM disbursements WHERE award_id = $1', [awardId]);
      await pool.query('DELETE FROM bursary_awards WHERE id = $1', [awardId]);
    }
    if (studentId && matchedStudentId) {
      await pool.query('DELETE FROM duplicate_flags WHERE (student_id = $1 AND matched_student_id = $2) OR (student_id = $2 AND matched_student_id = $1)', [studentId, matchedStudentId]);
    }
    if (studentId) {
      await pool.query(
        "DELETE FROM students WHERE id = $1",
        [studentId]
      );
    }

    if (matchedStudentId) await pool.query('DELETE FROM students WHERE id = $1', [matchedStudentId]);

    if (userId) {
      await pool.query("DELETE FROM audit_logs WHERE user_id = $1", [userId]);
      await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    }

    await pool.end();
  });

  test("GET /api/disbursements should require authentication", async () => {
    const response = await request(app)
      .get("/api/disbursements");

    expect(response.statusCode).toBe(401);
  });

  test("POST /api/disbursements should reject invalid amount", async () => {
    const response = await request(app)
      .post("/api/disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        award_id: awardId,
        amount: 0,
        payment_method: 'Test transfer',
      });

    expect(response.statusCode).toBe(400);
  });

  test("POST /api/disbursements creates an issued payment for an approved verified award", async () => {
    const response = await request(app)
      .post("/api/disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        award_id: awardId,
        amount: 5000,
        payment_method: 'Test transfer',
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.disbursement).toBeDefined();
    expect(Number(response.body.disbursement.amount)).toBe(5000);
    expect(response.body.disbursement.payment_status).toBe('issued');
  });

  test("POST /api/disbursements blocks an approved award while a duplicate review is pending", async () => {
    const matchedStudent = await pool.query(
      `INSERT INTO students (full_name, school_code, upi)
       VALUES ($1, 'Nairobi School', $2) RETURNING id`,
      [`Disbursement Test Match ${Date.now()}`, `UPI-MATCH-${Date.now()}`]
    );
    matchedStudentId = matchedStudent.rows[0].id;
    await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
       VALUES ($1, $2, 0.83, 'pending')`,
      [studentId, matchedStudentId]
    );

    const response = await request(app)
      .post('/api/disbursements')
      .set('Authorization', `Bearer ${token}`)
      .send({ award_id: awardId, amount: 1000, payment_method: 'Test transfer' });

    expect(response.statusCode).toBe(409);
    expect(response.body.message).toMatch(/resolve duplicate review cases/i);
  });
});
