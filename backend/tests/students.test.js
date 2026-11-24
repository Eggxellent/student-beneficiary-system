const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../src/index");
const pool = require("../src/config/db");

describe("Students API", () => {
  jest.setTimeout(30000);
  let token;
  let testUserId;

  beforeAll(async () => {
    const email = `studenttest${Date.now()}@example.com`;
    const password = "TestPassword123!";
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'field_officer') RETURNING id",
      ["Student Test Field Officer", email, passwordHash]
    );
    testUserId = account.rows[0].id;

    const loginResponse = await request(app)
      .post("/api/auth/login/field-officer")
      .send({ email, password });

    token = loginResponse.body.token;
  });

  afterAll(async () => {
    if (testUserId) {
      await pool.query("DELETE FROM audit_logs WHERE user_id = $1", [testUserId]);
      await pool.query("DELETE FROM users WHERE id = $1", [testUserId]);
    }
    await pool.end();
  });

  test("GET /api/students should require authentication", async () => {
    const response = await request(app).get("/api/students");

    expect(response.statusCode).toBe(401);
  });

  test("GET /api/students should return students for authenticated user", async () => {
    const response = await request(app)
      .get("/api/students")
      .set("Authorization", `Bearer ${token}`);

    expect(response.statusCode).toBe(200);
    const students = Array.isArray(response.body) ? response.body : response.body.value;
    expect(Array.isArray(students)).toBe(true);
  });

  test("school list contains only the five approved schools", async () => {
    const response = await request(app).get("/api/students/schools").set("Authorization", `Bearer ${token}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(["Nairobi School", "Alliance High", "Bishop Gatimu", "Loreto Limuru", "Maranda"]);
  });

  // Student registration is a Guardian Portal action: the staff route was removed with the
  // guardian pipeline, so a Field Officer who reaches it gets 404 and no row is created.
  test("staff cannot register a student; registration belongs to the guardian portal", async () => {
    const before = await pool.query("SELECT COUNT(*)::int AS total FROM students");
    const response = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "Invalid School Student", school_code: "Other Academy" });
    expect(response.statusCode).toBe(404);
    const after = await pool.query("SELECT COUNT(*)::int AS total FROM students");
    expect(after.rows[0].total).toBe(before.rows[0].total);
  });

  test("admin cannot access field-officer student or eligibility APIs", async () => {
    const email = `studentadmin${Date.now()}@example.com`;
    const password = "TestPassword123!";
    const password_hash = await bcrypt.hash(password, 12);
    const registration = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'admin') RETURNING id",
      ["Student Review Admin", email, password_hash]
    );
    const loginResponse = await request(app)
      .post("/api/auth/login/admin")
      .send({ email, password });
    const adminToken = loginResponse.body.token;

    try {
      expect((await request(app).get("/api/students").set("Authorization", `Bearer ${adminToken}`)).statusCode).toBe(403);
      expect((await request(app).post("/api/students").set("Authorization", `Bearer ${adminToken}`).send({})).statusCode).toBe(403);
      expect((await request(app).post("/api/eligibility").set("Authorization", `Bearer ${adminToken}`).send({})).statusCode).toBe(403);
    } finally {
      if (registration.rows[0]?.id) {
        await pool.query("DELETE FROM users WHERE id = $1", [registration.rows[0].id]);
      }
    }
  });

});
