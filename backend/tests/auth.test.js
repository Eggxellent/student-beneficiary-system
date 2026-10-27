const request = require("supertest");
const bcrypt = require("bcrypt");
const { randomUUID } = require("node:crypto");
const app = require("../src/index");
const pool = require("../src/config/db");
const Auth = require("../src/models/auth.model");

describe("Authentication API", () => {
  const createdUserIds = [];
  const createdUserEmails = [];
  const testUser = {
    full_name: "Test Field Officer",
    email: `testofficer-${randomUUID()}@example.com`,
    password: "TestPassword123!",
  };

  beforeAll(async () => {
    const password_hash = await bcrypt.hash(testUser.password, 12);
    createdUserEmails.push(testUser.email);
    const user = await Auth.createUser({
      full_name: testUser.full_name,
      email: testUser.email,
      password_hash,
      role: "field_officer",
    });
    createdUserIds.push(user.id);
  });

  test("public registration returns 410 without invoking account creation", async () => {
    const createUser = jest.spyOn(Auth, "createUser");
    const registrationEmail = `registration${Date.now()}@example.com`;
    try {
      const response = await request(app)
        .post("/api/auth/register")
        .send({ ...testUser, email: registrationEmail, role: "admin" });

      expect(response.statusCode).toBe(410);
      expect(response.body.message).toBe("Public registration is disabled.");
      expect(createUser).not.toHaveBeenCalled();
    } finally {
      createUser.mockRestore();
    }
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
    const loginResponse = await request(app)
      .post("/api/auth/login/field-officer")
      .send({ email: testUser.email, password: testUser.password });

    const response = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${loginResponse.body.token}`);

    expect(response.statusCode).toBe(403);
  });

  afterAll(async () => {
    const cleanupFailures = [];
    const attemptCleanup = async (label, operation) => {
      try {
        await operation();
      } catch {
        cleanupFailures.push(label);
      }
    };

    try {
      if (createdUserIds.length || createdUserEmails.length) {
        await attemptCleanup("audit-row cleanup", () => pool.query(
          `DELETE FROM audit_logs
           WHERE user_id = ANY($1::uuid[])
              OR record_id = ANY($1::uuid[])
              OR record_id IN (SELECT id FROM users WHERE email = ANY($2::text[]))`,
          [createdUserIds, createdUserEmails]
        ));
        await attemptCleanup("user cleanup", () => pool.query(
          'DELETE FROM users WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])',
          [createdUserIds, createdUserEmails]
        ));
      }
    } finally {
      await attemptCleanup("database pool shutdown", () => pool.end());
    }

    if (cleanupFailures.length) {
      throw new Error(`Test cleanup failed: ${cleanupFailures.join(", ")}`);
    }
  });
});
