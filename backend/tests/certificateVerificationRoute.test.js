const request = require("supertest");
const app = require("../src/index");
const certificateRateLimit = require("../src/middleware/certificateRateLimit");

// `/api/certificates/verify` is public and is the only endpoint that can tell a stranger whether a
// printed certificate is genuine, so its wiring is pinned the same way as `/api/verify`: exactly one
// route, the limiter on that route, the limiter before the JSON body is parsed, and a body that
// reveals nothing beyond the authenticity result.
describe("Public certificate verification route wiring", () => {
  async function exhaustBudget() {
    for (let attempt = 1; attempt <= 45; attempt += 1) {
      const response = await request(app).post("/api/certificates/verify").send({ token: "x" });
      if (response.statusCode === 429) {
        expect(response.body).toEqual({ message: "Too many requests. Try again later." });
        return attempt - 1;
      }
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ valid: false, status: "not_recognised" });
    }
    throw new Error("the certificate rate limiter never engaged");
  }

  beforeEach(() => {
    certificateRateLimit.reset();
  });

  afterAll(() => {
    certificateRateLimit.reset();
  });

  test("the handler is reached only through the rate limiter", async () => {
    const allowed = await exhaustBudget();
    expect(allowed).toBe(20);

    const refused = await request(app)
      .post("/api/certificates/verify")
      .send({ token: "a".repeat(64) });
    expect(refused.statusCode).toBe(429);
  });

  test("the limiter runs before the JSON body is parsed", async () => {
    await exhaustBudget();

    // Parsing first would answer 413. A throttled caller must be turned away before the API spends
    // work on the payload.
    const oversized = await request(app)
      .post("/api/certificates/verify")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ token: "x", padding: "y".repeat(101 * 1024) }));
    expect(oversized.statusCode).toBe(429);
    expect(oversized.body).toEqual({ message: "Too many requests. Try again later." });
  });

  test("an allowed caller still gets the size limit enforced by the route's parser", async () => {
    const oversized = await request(app)
      .post("/api/certificates/verify")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ token: "x", padding: "y".repeat(101 * 1024) }));
    expect(oversized.statusCode).toBe(413);
    expect(oversized.body).toEqual({ message: "Request body is too large" });

    const ordinary = await request(app).post("/api/certificates/verify").send({ token: "not-a-real-token" });
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.body).toEqual({ valid: false, status: "not_recognised" });
  });

  test("only POST is routed and a refusal exposes nothing else", async () => {
    expect((await request(app).get("/api/certificates/verify")).statusCode).toBe(404);

    const response = await request(app).post("/api/certificates/verify").send({ token: "not-a-real-token" });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(["status", "valid"]);
    expect(JSON.stringify(response.body)).not.toMatch(/name|school|upi|birth|phone|amount/i);
  });

  test("the manual-reference path is on the same limited route and answers the same way", async () => {
    const typed = await request(app)
      .post("/api/certificates/verify")
      .send({ reference: "SBMS-2026-2222-2222-222" });
    expect(typed.statusCode).toBe(200);
    expect(typed.body).toEqual({ valid: false, status: "not_recognised" });

    // A reference lookup spends the same per-IP budget as a QR lookup, so neither path can be used
    // to brute force around the other.
    await exhaustBudget();

    const refused = await request(app)
      .post("/api/certificates/verify")
      .send({ reference: "SBMS-2026-2222-2222-222" });
    expect(refused.statusCode).toBe(429);
    expect(refused.body).toEqual({ message: "Too many requests. Try again later." });
  });

  test("the student-record and certificate budgets are separate", async () => {
    await exhaustBudget();

    // A school that has checked many certificates must still be able to scan a student record.
    const studentRecord = await request(app).post("/api/verify").send({ token: "not-a-real-token" });
    expect(studentRecord.statusCode).toBe(200);
    expect(studentRecord.body).toEqual({ found: false });
  });
});
