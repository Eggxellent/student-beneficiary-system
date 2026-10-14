const request = require("supertest");
const app = require("../src/index");
const pool = require("../src/config/db");
const { buildDuplicateFeatures, calculateDuplicateScore } = require("../src/services/duplicateCheck");

describe("Students API", () => {
  let token;

  beforeAll(async () => {
    const email = `studenttest${Date.now()}@example.com`;
    const password = "TestPassword123!";

    await request(app)
      .post("/api/auth/register")
      .send({
        full_name: "Student Test Field Officer",
        email,
        password,
        role: "field_officer",
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

  test("admin cannot access field-officer student or eligibility APIs", async () => {
    const email = `studentadmin${Date.now()}@example.com`;
    const password = "TestPassword123!";
    const registration = await request(app)
      .post("/api/auth/register")
      .send({ full_name: "Student Review Admin", email, password, role: "admin" });
    const loginResponse = await request(app)
      .post("/api/auth/login")
      .send({ email, password });
    const adminToken = loginResponse.body.token;

    try {
      expect(registration.statusCode).toBe(201);
      expect((await request(app).get("/api/students").set("Authorization", `Bearer ${adminToken}`)).statusCode).toBe(403);
      expect((await request(app).post("/api/students").set("Authorization", `Bearer ${adminToken}`).send({})).statusCode).toBe(403);
      expect((await request(app).post("/api/eligibility").set("Authorization", `Bearer ${adminToken}`).send({})).statusCode).toBe(403);
    } finally {
      if (registration.body.user?.id) {
        await pool.query("DELETE FROM users WHERE id = $1", [registration.body.user.id]);
      }
    }
  });

  test("POST /api/students should persist the birth certificate number", async () => {
    const student = {
      full_name: `Certificate Test ${Date.now()}`,
      date_of_birth: "2010-05-14",
      school_code: "SCH-CERT-01",
      guardian_id: "G-CERT-01",
      upi: `UPI-CERT-${Date.now()}`,
      birth_certificate_number: `BC-CERT-${Date.now()}`,
    };

    const response = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send(student);

    expect(response.statusCode).toBe(201);
    expect(response.body.student.birth_certificate_number).toBe(student.birth_certificate_number);

    await pool.query("DELETE FROM students WHERE id = $1", [response.body.student.id]);
  });

  test("POST /api/students should register reused UPIs for admin review", async () => {
    const upi = `UPI-REUSED-${Date.now()}`;
    const firstResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "UPI Baseline Student", upi });

    const duplicateResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "Different Student", upi });

    expect(firstResponse.statusCode).toBe(201);
    expect(duplicateResponse.statusCode).toBe(201);
    expect(duplicateResponse.body.duplicate_flags).toHaveLength(1);
    expect(duplicateResponse.body.duplicate_flags[0].risk_level).toBe('critical');
    expect(duplicateResponse.body.message).toBe("Student registered successfully");

    const flags = await pool.query(
      "SELECT probability, status FROM duplicate_flags WHERE student_id = $1 AND matched_student_id = $2",
      [duplicateResponse.body.student.id, firstResponse.body.student.id]
    );
    expect(flags.rows).toHaveLength(1);
    expect(Number(flags.rows[0].probability)).toBeGreaterThanOrEqual(0.3);
    expect(Number(flags.rows[0].probability)).toBeLessThan(0.7);
    expect(flags.rows[0].status).toBe("pending");

    await pool.query("DELETE FROM duplicate_flags WHERE student_id = $1 OR student_id = $2", [firstResponse.body.student.id, duplicateResponse.body.student.id]);
    await pool.query("DELETE FROM students WHERE id = $1 OR id = $2", [firstResponse.body.student.id, duplicateResponse.body.student.id]);
  });

  test("POST /api/students should prioritize an exact birth certificate match", async () => {
    const suffix = Date.now();
    const firstResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({
        full_name: "Nia Wanjiku",
        date_of_birth: "2009-03-12",
        school_code: "SCH-014",
        guardian_id: "G-481725",
        birth_certificate_number: `BC-2009-${suffix}`,
        upi: `UPI-${Math.floor(10000000 + Math.random() * 90000000)}`,
      });
    const secondResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({
        full_name: "Tendo Kiptoo",
        date_of_birth: "2012-09-24",
        school_code: "SCH-079",
        guardian_id: "G-735402",
        birth_certificate_number: `BC-2009-${suffix}`,
        upi: `UPI-${Math.floor(10000000 + Math.random() * 90000000)}`,
      });

    expect(firstResponse.statusCode).toBe(201);
    expect(secondResponse.statusCode).toBe(201);
    const duplicateFlag = await pool.query(
      "SELECT probability, status FROM duplicate_flags WHERE student_id = $1 AND matched_student_id = $2",
      [secondResponse.body.student.id, firstResponse.body.student.id]
    );
    expect(duplicateFlag.rows).toHaveLength(1);
    expect(Number(duplicateFlag.rows[0].probability)).toBeGreaterThanOrEqual(0.3);
    expect(Number(duplicateFlag.rows[0].probability)).toBeLessThan(0.7);
    expect(duplicateFlag.rows[0].status).toBe("pending");

    await pool.query("DELETE FROM duplicate_flags WHERE student_id = $1 OR student_id = $2", [firstResponse.body.student.id, secondResponse.body.student.id]);
    await pool.query("DELETE FROM students WHERE id = $1 OR id = $2", [firstResponse.body.student.id, secondResponse.body.student.id]);
  });

  test("POST /api/students should keep non-unique matches in review", async () => {
    const suffix = Date.now();
    const shared = {
      date_of_birth: "2010-05-14",
      school_code: "SCH-042",
      guardian_id: "G-384720",
    };
    const firstResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...shared, full_name: "Miriam Chebet", upi: `UPI-${Math.floor(10000000 + Math.random() * 90000000)}`, birth_certificate_number: `BC-2010-${Math.floor(100000 + Math.random() * 900000)}` });
    const secondResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ ...shared, full_name: "Miriam Chebet", upi: `UPI-${Math.floor(10000000 + Math.random() * 90000000)}`, birth_certificate_number: `BC-2011-${Math.floor(100000 + Math.random() * 900000)}` });

    const studentIds = [firstResponse.body.student?.id, secondResponse.body.student?.id].filter(Boolean);
    try {
      expect(firstResponse.statusCode).toBe(201);
      expect(secondResponse.statusCode).toBe(201);
      const baselineFeatures = buildDuplicateFeatures(firstResponse.body.student, secondResponse.body.student);
      expect(baselineFeatures).toEqual({
        jaro_winkler: 1,
        dob_match: 1,
        school_match: 1,
        guardian_match: 1,
        upi_match: 0,
        birth_certificate_match: 0,
      });
      expect(calculateDuplicateScore(baselineFeatures)).toBe(0.2);
      const baselineMatch = await pool.query(
        "SELECT probability, status FROM duplicate_flags WHERE student_id = $1 AND matched_student_id = $2",
        [secondResponse.body.student.id, firstResponse.body.student.id]
      );
      expect(baselineMatch.rows).toHaveLength(1);
      expect(Number(baselineMatch.rows[0].probability)).toBe(0.2);
      expect(baselineMatch.rows[0].status).toBe("pending");
    } finally {
      if (studentIds.length) {
        await pool.query("DELETE FROM duplicate_flags WHERE student_id = ANY($1::uuid[]) OR matched_student_id = ANY($1::uuid[])", [studentIds]);
        await pool.query("DELETE FROM students WHERE id = ANY($1::uuid[])", [studentIds]);
      }
    }
  });
});
