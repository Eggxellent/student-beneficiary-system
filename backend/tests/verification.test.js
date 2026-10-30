const request = require("supertest");
const bcrypt = require("bcrypt");
const QRCode = require("qrcode");
const app = require("../src/index");
const pool = require("../src/config/db");
const { buildStudentVerificationUrl } = require("../src/config/publicAppUrl");

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

describe("Public QR verification", () => {
  jest.setTimeout(30000);

  let officerToken;
  let officerId;
  let studentId;
  let qrToken;
  let registration;

  beforeAll(async () => {
    const email = `qrverify${Date.now()}@example.com`;
    const password = "TestPassword123!";
    const passwordHash = await bcrypt.hash(password, 12);
    const account = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'field_officer') RETURNING id",
      ["QR Verification Officer", email, passwordHash]
    );
    officerId = account.rows[0].id;
    const login = await request(app).post("/api/auth/login/field-officer").send({ email, password });
    officerToken = login.body.token;

    registration = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({
        full_name: `QR Subject ${Date.now()}`,
        date_of_birth: "2011-06-01",
        school_code: "Nairobi School",
        national_id_number: `QR-NID-${Date.now()}`,
        primary_phone: "+254799000111",
      });
    if (registration.statusCode !== 201 || !registration.body.student) {
      throw new Error(
        `verification setup could not register a student: ${registration.statusCode} ${JSON.stringify(registration.body)}`
      );
    }
    studentId = registration.body.student.id;
    const stored = await pool.query("SELECT qr_token FROM students WHERE id = $1", [studentId]);
    qrToken = stored.rows[0].qr_token;
  });

  afterAll(async () => {
    if (studentId) {
      await pool.query("DELETE FROM duplicate_flags WHERE student_id = $1 OR matched_student_id = $1", [studentId]);
      await pool.query("DELETE FROM audit_logs WHERE table_name = 'students' AND record_id = $1", [studentId]);
      await pool.query("DELETE FROM students WHERE id = $1", [studentId]);
    }
    if (officerId) await pool.query("DELETE FROM users WHERE id = $1", [officerId]);
  });

  test("registration issues a 64-character lowercase hex token", () => {
    expect(registration.statusCode).toBe(201);
    expect(typeof qrToken).toBe("string");
    expect(qrToken).toMatch(TOKEN_PATTERN);
  });

  test("the QR image encodes the verification URL with the token in the fragment", async () => {
    const expectedUrl = buildStudentVerificationUrl(qrToken);
    // The fragment keeps the token out of server logs and Referer headers, so the encoded
    // payload must be a fragment URL rather than a query string.
    expect(expectedUrl).toContain("/verify#token=");
    expect(expectedUrl).not.toContain("?");
    const expectedImage = await QRCode.toDataURL(expectedUrl);
    expect(registration.body.qr_code).toBe(expectedImage);
  });

  test("the registration response never returns the token in the student object", () => {
    expect(registration.body.student.qr_token).toBeUndefined();
    expect(JSON.stringify(registration.body.student)).not.toContain(qrToken);
  });

  test("a valid token verifies and returns nothing but found:true", async () => {
    const response = await request(app).post("/api/verify").send({ token: qrToken });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ found: true });
    expect(JSON.stringify(response.body)).not.toMatch(/name|school|dob|birth|upi|phone/i);
  });

  test("an unknown token is refused without revealing that it is well formed", async () => {
    const response = await request(app).post("/api/verify").send({ token: "a".repeat(64) });
    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ found: false });
  });

  test("malformed tokens are refused the same way", async () => {
    const candidates = [qrToken.slice(0, 63), qrToken.toUpperCase(), "z".repeat(64), "", 42, null];
    for (const token of candidates) {
      const response = await request(app).post("/api/verify").send({ token });
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ found: false });
    }
  });

  test("extra body fields are refused instead of being ignored", async () => {
    const response = await request(app).post("/api/verify").send({ token: qrToken, full_name: "Someone" });
    expect(response.body).toEqual({ found: false });
  });

  test("an empty body is refused", async () => {
    const response = await request(app).post("/api/verify").send({});
    expect(response.body).toEqual({ found: false });
  });

  // Deliberately last: this exhausts the per-client budget for the whole file.
  test("rate limiting stops one client after the configured budget", async () => {
    const statuses = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await request(app).post("/api/verify").send({ token: qrToken });
      statuses.push(response.statusCode);
      if (response.statusCode === 429) {
        expect(response.body).toEqual({ message: "Too many requests. Try again later." });
        expect(JSON.stringify(response.body)).not.toContain(qrToken);
        break;
      }
    }
    expect(statuses).toContain(429);
  });

  // Forwarded headers are only honoured when TRUST_PROXY_HOPS is configured, so a client
  // cannot escape the limit by inventing an X-Forwarded-For value.
  test("a forged X-Forwarded-For does not create a fresh budget", async () => {
    const response = await request(app)
      .post("/api/verify")
      .set("X-Forwarded-For", "203.0.113.7")
      .send({ token: qrToken });
    expect(response.statusCode).toBe(429);
  });
});
