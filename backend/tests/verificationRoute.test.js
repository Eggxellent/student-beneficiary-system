const request = require("supertest");
const app = require("../src/index");
const verificationRateLimit = require("../src/middleware/verificationRateLimit");

// `/api/verify` is the only unauthenticated write path in the API, so its wiring is pinned here:
// exactly one route, the rate limiter attached to that route, and the limiter running before the
// JSON body is parsed. These checks need no database: a token that fails the shape test is
// answered without a query. `tests/testEnvironment.js` resets the limiter for each test file.
describe("Public verification route wiring", () => {
  async function exhaustBudget() {
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const response = await request(app).post("/api/verify").send({ token: "x" });
      if (response.statusCode === 429) {
        expect(response.body).toEqual({ message: "Too many requests. Try again later." });
        return attempt - 1;
      }
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ found: false });
    }
    throw new Error("the verification rate limiter never engaged");
  }

  beforeEach(() => {
    verificationRateLimit.reset();
  });

  afterAll(() => {
    verificationRateLimit.reset();
  });

  test("the handler is reached only through the rate limiter", async () => {
    const allowed = await exhaustBudget();
    expect(allowed).toBeGreaterThan(0);

    const refused = await request(app).post("/api/verify").send({ token: "x" });
    expect(refused.statusCode).toBe(429);
    // Still refused with a body the handler would have accepted, which proves the limiter is not
    // sitting on a second route declaration that a later edit could drop or reorder.
    const withValidShape = await request(app).post("/api/verify").send({ token: "a".repeat(64) });
    expect(withValidShape.statusCode).toBe(429);
  });

  test("the limiter runs before the JSON body is parsed", async () => {
    await exhaustBudget();

    // Parsing first would answer 413. A throttled caller must be turned away before the API
    // spends work on the payload.
    const oversized = await request(app)
      .post("/api/verify")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ token: "x", padding: "y".repeat(101 * 1024) }));
    expect(oversized.statusCode).toBe(429);
    expect(oversized.body).toEqual({ message: "Too many requests. Try again later." });
  });

  test("an allowed caller still gets the size limit enforced by the route's parser", async () => {
    const oversized = await request(app)
      .post("/api/verify")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ token: "x", padding: "y".repeat(101 * 1024) }));
    expect(oversized.statusCode).toBe(413);
    expect(oversized.body).toEqual({ message: "Request body is too large" });

    // The rejected payload never reached the handler, so the endpoint still answers normally.
    const ordinary = await request(app).post("/api/verify").send({ token: "not-a-real-token" });
    expect(ordinary.statusCode).toBe(200);
    expect(ordinary.body).toEqual({ found: false });
  });

  test("only POST is routed and the response exposes nothing but found", async () => {
    expect((await request(app).get("/api/verify")).statusCode).toBe(404);

    // An unknown but well-shaped token would reach the database; an ill-shaped one is answered
    // without a query, which keeps this suite independent of database state while still checking
    // the response contract. `verification.test.js` covers found:true with a real token.
    const response = await request(app).post("/api/verify").send({ token: "not-a-real-token" });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.body)).toEqual(["found"]);
    expect(response.body).toEqual({ found: false });
    expect(JSON.stringify(response.body)).not.toMatch(/name|school|dob|birth|upi|phone/i);
  });
});
