const request = require("supertest");
const app = require("../src/index");

describe("Authentication API", () => {
  const testUser = {
    full_name: "Test Admin",
    email: `testadmin${Date.now()}@example.com`,
    password: "TestPassword123!",
    role: "admin",
  };

  test("POST /api/auth/register should create a user", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send(testUser);

    expect(response.statusCode).toBe(201);
    expect(response.body.user).toBeDefined();
    expect(response.body.user.email).toBe(testUser.email);
    expect(response.body.user.role).toBe('field_officer');
  });

  test("POST /api/auth/login should return a JWT", async () => {
    const response = await request(app)
      .post("/api/auth/login")
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

    await request(app).post("/api/auth/register").send(officer);
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email: officer.email, password: officer.password });

    const response = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(response.statusCode).toBe(403);
  });
});
