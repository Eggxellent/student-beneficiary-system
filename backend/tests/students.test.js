const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../src/index");
const pool = require("../src/config/db");
const { buildDuplicateFeatures, calculateDuplicateScore } = require("../src/services/duplicateCheck");
const { getMlReviewScoreThreshold, getDuplicateThreshold } = require("../src/config/settings");

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

  test("student registration rejects schools outside the approved list", async () => {
    const response = await request(app).post("/api/students").set("Authorization", `Bearer ${token}`).send({
      full_name: "Invalid School Student", school_code: "Other Academy",
    });
    expect(response.statusCode).toBe(400);
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

  test("POST /api/students should persist the birth certificate number", async () => {
    const student = {
      full_name: `Certificate Test ${Date.now()}`,
      date_of_birth: "2010-05-14",
      school_code: "Nairobi School",
      guardian_id: "G-CERT-01",
      upi: `UPI-CERT-${Date.now()}`,
      birth_certificate_number: `BC-CERT-${Date.now()}`,
      is_synthetic: true,
    };

    const response = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send(student);

    expect(response.statusCode).toBe(201);
    expect(response.body.student.birth_certificate_number).toBe(student.birth_certificate_number);
    expect(response.body.student.is_synthetic).toBe(false);

    await pool.query("DELETE FROM students WHERE id = $1", [response.body.student.id]);
  });

  test("POST /api/students should register reused UPIs for admin review", async () => {
    const upi = `UPI-REUSED-${Date.now()}`;
    const firstResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "UPI Baseline Student", upi, school_code: "Nairobi School" });

    const duplicateResponse = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${token}`)
      .send({ full_name: "Different Student", upi, school_code: "Nairobi School" });

    expect(firstResponse.statusCode).toBe(201);
    expect(duplicateResponse.statusCode).toBe(201);
    expect(duplicateResponse.body.duplicate_flags).toHaveLength(1);
    expect(duplicateResponse.body.duplicate_flags[0].risk_level).toBe('review');
    expect(duplicateResponse.body.duplicate_flags[0].review_reason).toMatch(/exact UPI match/i);
    // Contract shared with the admin queue: severity is `priority`, and the exact
    // identifier list is published as evidence instead of being parsed out of prose.
    expect(duplicateResponse.body.duplicate_flags[0].priority).toBe('high');
    expect(duplicateResponse.body.duplicate_flags[0].exact_identifier_matches).toEqual(['UPI']);
    const screening = duplicateResponse.body.duplicate_screening;
    expect(screening.aggregation_policy).toBeTruthy();
    expect(screening.candidates_considered).toBeGreaterThanOrEqual(1);
    expect(screening.candidates_qualifying).toBeGreaterThanOrEqual(1);
    expect(screening.candidates_suppressed).toBe(0);
    expect(screening.review_threshold).toBe(getMlReviewScoreThreshold());
    expect(screening.high_priority_threshold).toBe(getDuplicateThreshold());
    expect(screening.thresholds_validated).toBe(false);
    expect(screening.score_is_calibrated_probability).toBe(false);
    expect(duplicateResponse.body.message).toBe("Student registered successfully");

    const flags = await pool.query(
      "SELECT probability, status FROM duplicate_flags WHERE student_id = $1 AND matched_student_id = $2",
      [duplicateResponse.body.student.id, firstResponse.body.student.id]
    );
    expect(flags.rows).toHaveLength(1);
    expect(Number(flags.rows[0].probability)).toBe(duplicateResponse.body.duplicate_flags[0].model_score);
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
        school_code: "Alliance High",
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
        school_code: "Maranda",
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
    expect(duplicateFlag.rows[0].probability).toBeDefined();
    expect(duplicateFlag.rows[0].status).toBe("pending");
    expect(secondResponse.body.duplicate_flags[0].review_reason).toMatch(/exact birth certificate number match/i);

    await pool.query("DELETE FROM duplicate_flags WHERE student_id = $1 OR student_id = $2", [firstResponse.body.student.id, secondResponse.body.student.id]);
    await pool.query("DELETE FROM students WHERE id = $1 OR id = $2", [firstResponse.body.student.id, secondResponse.body.student.id]);
  });

  test("POST /api/students should keep non-unique matches in review", async () => {
    const suffix = Date.now();
    const shared = {
      date_of_birth: "2010-05-14",
      school_code: "Loreto Limuru",
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
        national_id_match: 0,
      });
      expect(calculateDuplicateScore(baselineFeatures)).toBe(0.2);
      const baselineMatch = await pool.query(
        "SELECT probability, status FROM duplicate_flags WHERE student_id = $1 AND matched_student_id = $2",
        [secondResponse.body.student.id, firstResponse.body.student.id]
      );
      expect(baselineMatch.rows).toHaveLength(1);
      expect(Number(baselineMatch.rows[0].probability)).toBeGreaterThanOrEqual(secondResponse.body.duplicate_screening.review_threshold);
      expect(baselineMatch.rows[0].status).toBe("pending");
    } finally {
      if (studentIds.length) {
        await pool.query("DELETE FROM duplicate_flags WHERE student_id = ANY($1::uuid[]) OR matched_student_id = ANY($1::uuid[])", [studentIds]);
        await pool.query("DELETE FROM students WHERE id = ANY($1::uuid[])", [studentIds]);
      }
    }
  });
});
