const request = require("supertest");
const app = require("../src/index");

describe("Students API", () => {
  let token;

  beforeAll(async () => {
    const email = `studenttest${Date.now()}@example.com`;
    const password = "TestPassword123!";

    await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Student Test Admin",
        email,
        password,
        role: "admin",
      });

    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email, password });

    token = loginResponse.body.token;
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
});
