const request = require("supertest");
const app = require("../src/index");
const pool = require("../src/config/db");

describe("Authentication API", () => {
  const createdUserIds = [];
  const testUser = {
    full_name: "Test Field Officer",
    email: `testadmin${Date.now()}@example.com`,
    password: "TestPassword123!",
    role: "admin",
  };

  test("public registration creates a field officer and ignores an attempted admin role", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send(testUser);

    expect(response.statusCode).toBe(201);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.email).toBe(testUser.email);
    expect(response.body.user.role).toBe("field_officer");
    createdUserIds.push(response.body.user.id);
  });

  test("Field Officer sign-in should return a JWT for a Field Officer account", async () => {
    const response = await request(app)
      .post("/api/auth/login/field-officer")
      .send({
        email: testUser.email,
        password: testUser.password,
      });

    expect(response.statusCode).toBe(200);
    expect(response.body.token).toBeDefined();
    expect(typeof response.body.token).toBe("string");
  });

  test("protected endpoints should reject an invalid JWT", async () => {
    const response = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", "Bearer invalid-token");

    expect(response.statusCode).toBe(401);
  });

  test("admin-only endpoints should reject field officers", async () => {
    const officer = {
      full_name: "Test Field Officer",
      email: `fieldofficer${Date.now()}@example.com`,
      password: "TestPassword123!",
      role: "field_officer",
    };

    const registration = await request(app).post("/api/auth/register").send(officer);
    createdUserIds.push(registration.body.user.id);
    const loginResponse = await request(app)
      .post("/api/auth/login/field-officer")
      .send({ email: officer.email, password: officer.password });

    const response = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(response.statusCode).toBe(403);
  });

  afterAll(async () => {
    if (createdUserIds.length) {
      await pool.query("DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])", [createdUserIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUserIds]);
    }
    await pool.end();
  });
});
