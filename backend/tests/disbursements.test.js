const request = require("supertest");
const app = require("../src/index");
const pool = require("../src/config/db");

describe("Disbursements API", () => {
  let token;
  let studentId;
  let userId;

  beforeAll(async () => {
    const email = `disbursementtest${Date.now()}@example.com`;
    const password = "TestPassword123!";

    const registration = await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Disbursement Test Field Officer",
        email,
        password,
        role: "field_officer",
      });
    userId = registration.body.user?.id;

    const loginResponse = await request(app)
      .post("/api/auth/login/field-officer")
      .send({
        email,
        password,
      });

    token = loginResponse.body.token;

    const studentResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({
        full_name: "Disbursement Test Student",
        date_of_birth: "2005-01-01",
        school_code: "Nairobi School",
        guardian_id: `GUARD-${Date.now()}`,
        upi: `UPI-TEST-${Date.now()}`,
      });

    studentId = studentResponse.body.student.id;
  });

  afterAll(async () => {
    if (studentId) {
      await pool.query(
        "DELETE FROM students WHERE id = $1",
        [studentId]
      );
    }

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
        student_id: studentId,
        amount: 0,
      });

    expect(response.statusCode).toBe(400);
  });

  test("POST /api/disbursements should create a valid disbursement", async () => {
    const response = await request(app)
      .post("/api/disbursements")
      .set("Authorization", `Bearer ${token}`)
      .send({
        student_id: studentId,
        amount: 5000,
      });

    expect(response.statusCode).toBe(201);
    expect(response.body.disbursement).toBeDefined();
    expect(Number(response.body.disbursement.amount)).toBe(5000);
  });
});
