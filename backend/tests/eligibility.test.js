const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../src/index");
const pool = require("../src/config/db");
const { calculateEligibility } = require("../src/services/eligibility");

const RANGE_ENV = [
  "ELIGIBILITY_RANGE_HIGH_MIN",
  "ELIGIBILITY_RANGE_HIGH_MAX",
  "ELIGIBILITY_RANGE_MODERATE_MIN",
  "ELIGIBILITY_RANGE_MODERATE_MAX",
  "ELIGIBILITY_RANGE_LOW_MIN",
  "ELIGIBILITY_RANGE_LOW_MAX",
];

// Michael Mwangi of Nairobi School: an orphaned Form 3 learner whose family
// income cannot cover the term's fee balance.
const MICHAEL_INPUTS = {
  fee_balance: 52000,
  household_income: 18000,
  vulnerability_status: "high",
  siblings_in_school: 4,
  prior_bursary_history: "none",
};

describe("Eligibility scoring formula", () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = {};
    for (const name of RANGE_ENV) {
      savedEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of RANGE_ENV) {
      if (savedEnv[name] === undefined) delete process.env[name];
      else process.env[name] = savedEnv[name];
    }
  });

  test("fee balance awards 30/25/15/5/0 points at its tier boundaries", () => {
    const cases = [
      [0, 0],
      [1, 5],
      [14999, 5],
      [15000, 15],
      [29999, 15],
      [30000, 25],
      [49999, 25],
      [50000, 30],
      [120000, 30],
    ];

    for (const [feeBalance, expected] of cases) {
      const assessment = calculateEligibility({ ...MICHAEL_INPUTS, fee_balance: feeBalance });
      expect(assessment.breakdown.fee_balance).toBe(expected);
    }

    expect(calculateEligibility({ ...MICHAEL_INPUTS, fee_balance: 0 }).reasons).toContain(
      "No outstanding school fees"
    );
    expect(calculateEligibility({ ...MICHAEL_INPUTS, fee_balance: 60000 }).reasons).toContain(
      "High outstanding school fees"
    );
  });
  test("household income awards 25/20/10/0 points at its tier boundaries", () => {
    const cases = [
      [0, 25],
      [20000, 25],
      [20001, 20],
      [40000, 20],
      [40001, 10],
      [60000, 10],
      [60001, 0],
      [250000, 0],
    ];

    for (const [income, expected] of cases) {
      const assessment = calculateEligibility({ ...MICHAEL_INPUTS, household_income: income });
      expect(assessment.breakdown.household_income).toBe(expected);
    }

    expect(calculateEligibility({ ...MICHAEL_INPUTS, household_income: 9000 }).reasons).toContain(
      "Very low household income"
    );
    expect(calculateEligibility({ ...MICHAEL_INPUTS, household_income: 90000 }).reasons).toContain(
      "Household income is above the scoring threshold"
    );
  });

  test("vulnerability status awards 25/15/5 points and is case-insensitive", () => {
    const points = (status) =>
      calculateEligibility({ ...MICHAEL_INPUTS, vulnerability_status: status }).breakdown.vulnerability_status;

    expect(points("high")).toBe(25);
    expect(points("medium")).toBe(15);
    expect(points("low")).toBe(5);
    expect(points("HIGH")).toBe(25);
  });

  test("siblings in school awards 10/7/3/0 points", () => {
    const cases = [
      [0, 0],
      [1, 3],
      [2, 7],
      [3, 7],
      [4, 10],
      [7, 10],
    ];

    for (const [siblings, expected] of cases) {
      const assessment = calculateEligibility({ ...MICHAEL_INPUTS, siblings_in_school: siblings });
      expect(assessment.breakdown.siblings_in_school).toBe(expected);
    }
  });

  test("prior bursary history awards 10/7/2 points and is case-insensitive", () => {
    const points = (history) =>
      calculateEligibility({ ...MICHAEL_INPUTS, prior_bursary_history: history }).breakdown.prior_bursary_history;

    expect(points("none")).toBe(10);
    expect(points("low")).toBe(7);
    expect(points("high")).toBe(2);
    expect(points("High")).toBe(2);
  });
  test("the five weighted factors add up to the score out of 100", () => {
    const assessment = calculateEligibility(MICHAEL_INPUTS);

    expect(assessment.factors).toHaveLength(5);
    expect(assessment.factors.map((factor) => factor.max_points)).toEqual([30, 25, 25, 10, 10]);
    expect(Object.values(assessment.breakdown).reduce((total, points) => total + points, 0)).toBe(assessment.score);
    expect(assessment.score).toBe(100);
    expect(assessment.max_score).toBe(100);
    expect(assessment.formula.category_bands).toEqual([
      { category: "high", label: "High", min: 70, max: 100 },
      { category: "moderate", label: "Moderate", min: 40, max: 69 },
      { category: "low", label: "Low", min: 0, max: 39 },
    ]);
  });

  test("score bands map 70-100 High, 40-69 Moderate and 0-39 Low", () => {
    // 30 + 25 + 5 + 0 + 10 = 70
    const highBoundary = calculateEligibility({
      fee_balance: 64000,
      household_income: 15000,
      vulnerability_status: "low",
      siblings_in_school: 0,
      prior_bursary_history: "none",
    });
    expect(highBoundary.score).toBe(70);
    expect(highBoundary.category).toBe("high");
    expect(highBoundary.category_label).toBe("High");

    // 30 + 10 + 15 + 7 + 7 = 69
    const moderateTop = calculateEligibility({
      fee_balance: 50000,
      household_income: 50000,
      vulnerability_status: "medium",
      siblings_in_school: 2,
      prior_bursary_history: "low",
    });
    expect(moderateTop.score).toBe(69);
    expect(moderateTop.category).toBe("moderate");
    expect(moderateTop.category_label).toBe("Moderate");

    // 15 + 10 + 5 + 3 + 7 = 40
    const moderateBottom = calculateEligibility({
      fee_balance: 15000,
      household_income: 50000,
      vulnerability_status: "low",
      siblings_in_school: 1,
      prior_bursary_history: "low",
    });
    expect(moderateBottom.score).toBe(40);
    expect(moderateBottom.category).toBe("moderate");

    // 15 + 10 + 5 + 7 + 2 = 39
    const lowTop = calculateEligibility({
      fee_balance: 15000,
      household_income: 50000,
      vulnerability_status: "low",
      siblings_in_school: 2,
      prior_bursary_history: "high",
    });
    expect(lowTop.score).toBe(39);
    expect(lowTop.category).toBe("low");
    expect(lowTop.category_label).toBe("Low");

    // 0 + 0 + 5 + 0 + 2 = 7
    const lowFloor = calculateEligibility({
      fee_balance: 0,
      household_income: 90000,
      vulnerability_status: "low",
      siblings_in_school: 0,
      prior_bursary_history: "high",
    });
    expect(lowFloor.score).toBe(7);
    expect(lowFloor.category).toBe("low");
  });
  test("recommended cash ranges fall back to the provisional defaults", () => {
    const assessment = calculateEligibility(MICHAEL_INPUTS);

    expect(assessment.recommended_range).toEqual({
      currency: "KES",
      min: 15000,
      max: 25000,
      provisional: true,
      source: "Provisional proposal - no approved allocation ranges configured",
    });
    expect(assessment.formula.amount_ranges).toEqual({
      high: { min: 15000, max: 25000 },
      moderate: { min: 8000, max: 15000 },
      low: { min: 3000, max: 8000 },
    });
    expect(assessment.formula.amount_ranges_provisional).toBe(true);

    const low = calculateEligibility({
      fee_balance: 0,
      household_income: 90000,
      vulnerability_status: "low",
      siblings_in_school: 0,
      prior_bursary_history: "high",
    });
    expect(low.recommended_range).toMatchObject({ min: 3000, max: 8000, provisional: true });
  });

  test("configured allocation ranges replace the provisional defaults", () => {
    process.env.ELIGIBILITY_RANGE_HIGH_MIN = "20000";
    process.env.ELIGIBILITY_RANGE_HIGH_MAX = "30000";
    process.env.ELIGIBILITY_RANGE_MODERATE_MIN = "12000";
    process.env.ELIGIBILITY_RANGE_MODERATE_MAX = "20000";
    process.env.ELIGIBILITY_RANGE_LOW_MIN = "5000";
    process.env.ELIGIBILITY_RANGE_LOW_MAX = "12000";

    const high = calculateEligibility(MICHAEL_INPUTS);
    expect(high.recommended_range).toMatchObject({ min: 20000, max: 30000, provisional: false });
    expect(high.recommended_range.source).toBe("Configured in server environment (ELIGIBILITY_RANGE_*)");

    const moderate = calculateEligibility({
      fee_balance: 50000,
      household_income: 50000,
      vulnerability_status: "medium",
      siblings_in_school: 2,
      prior_bursary_history: "low",
    });
    expect(moderate.recommended_range).toMatchObject({ min: 12000, max: 20000, provisional: false });

    const low = calculateEligibility({
      fee_balance: 0,
      household_income: 90000,
      vulnerability_status: "low",
      siblings_in_school: 0,
      prior_bursary_history: "high",
    });
    expect(low.recommended_range).toMatchObject({ min: 5000, max: 12000, provisional: false });
  });

  test("incomplete or invalid allocation configuration keeps the provisional defaults", () => {
    process.env.ELIGIBILITY_RANGE_HIGH_MIN = "20000";
    process.env.ELIGIBILITY_RANGE_HIGH_MAX = "30000";
    expect(calculateEligibility(MICHAEL_INPUTS).recommended_range).toMatchObject({
      min: 15000,
      max: 25000,
      provisional: true,
    });

    process.env.ELIGIBILITY_RANGE_MODERATE_MIN = "12000";
    process.env.ELIGIBILITY_RANGE_MODERATE_MAX = "20000";
    process.env.ELIGIBILITY_RANGE_LOW_MIN = "5000";
    process.env.ELIGIBILITY_RANGE_LOW_MAX = "not-a-number";
    expect(calculateEligibility(MICHAEL_INPUTS).recommended_range.provisional).toBe(true);

    // max below min is rejected, so the provisional defaults stay in force
    process.env.ELIGIBILITY_RANGE_LOW_MAX = "4000";
    expect(calculateEligibility(MICHAEL_INPUTS).recommended_range).toMatchObject({
      min: 15000,
      max: 25000,
      provisional: true,
    });

    process.env.ELIGIBILITY_RANGE_HIGH_MIN = "30000";
    process.env.ELIGIBILITY_RANGE_HIGH_MAX = "20000";
    expect(calculateEligibility(MICHAEL_INPUTS).recommended_range.provisional).toBe(true);
  });
});
describe("Eligibility API", () => {
  jest.setTimeout(30000);
  let officerId;
  let officerToken;
  let adminId;
  let adminToken;
  const studentIds = [];

  async function createAccount(role, fullName, emailPrefix) {
    const email = `${emailPrefix}${Date.now()}@sbms.test`;
    const password = "TestPassword123!";
    const passwordHash = await bcrypt.hash(password, 12);
    const inserted = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
      [fullName, email, passwordHash, role]
    );
    const login = await request(app)
      .post(`/api/auth/login/${role === "admin" ? "admin" : "field-officer"}`)
      .send({ email, password });
    return { id: inserted.rows[0].id, token: login.body.token };
  }

  async function createStudent(overrides = {}) {
    const student = {
      full_name: "Michael Mwangi",
      school_code: "Nairobi School",
      upi: `UPI-MWANGI-${Date.now()}`,
      birth_certificate_number: `BC-2019-${Date.now()}`,
      guardian_id: "254712345678",
      primary_phone: "254712345678",
      ...overrides,
    };
    const inserted = await pool.query(
      `INSERT INTO students (full_name, school_code, upi, birth_certificate_number, guardian_id, primary_phone)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        student.full_name,
        student.school_code,
        student.upi,
        student.birth_certificate_number,
        student.guardian_id,
        student.primary_phone,
      ]
    );
    studentIds.push(inserted.rows[0].id);
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
       VALUES ($1, 'CREATE', 'students', $2, $3)`,
      [officerId, inserted.rows[0].id, { duplicate_model_version: 'test-screened', duplicate_flags_created: 0 }],
    );
    return inserted.rows[0].id;
  }

  beforeAll(async () => {
    const officer = await createAccount("field_officer", "Peter Kamau", "eligibilityofficer");
    officerId = officer.id;
    officerToken = officer.token;

    const admin = await createAccount("admin", "Grace Njeri", "eligibilityadmin");
    adminId = admin.id;
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (studentIds.length) {
      await pool.query("DELETE FROM audit_logs WHERE record_id = ANY($1::uuid[])", [studentIds]);
      await pool.query("DELETE FROM students WHERE id = ANY($1::uuid[])", [studentIds]);
    }
    for (const id of [officerId, adminId]) {
      if (id) {
        await pool.query("DELETE FROM audit_logs WHERE user_id = $1", [id]);
        await pool.query("DELETE FROM users WHERE id = $1", [id]);
      }
    }
    await pool.end();
  });

  test("eligibility requires a field officer token", async () => {
    const response = await request(app).post("/api/eligibility").send(MICHAEL_INPUTS);
    expect(response.statusCode).toBe(401);
  });

  test("a field officer cannot read the weighting formula", async () => {
    const response = await request(app).get("/api/eligibility").set("Authorization", `Bearer ${officerToken}`);
    expect(response.statusCode).toBe(403);
  });

  test("an administrator can read the formula but cannot run an assessment", async () => {
    const formula = await request(app).get("/api/eligibility").set("Authorization", `Bearer ${adminToken}`);
    expect(formula.statusCode).toBe(200);
    expect(formula.body.factors).toHaveLength(5);
    expect(formula.body.category_bands.map((band) => band.category)).toEqual(["high", "moderate", "low"]);
    expect(formula.body.amount_ranges.high).toEqual({ min: 15000, max: 25000 });

    const studentId = await createStudent();
    const attempt = await request(app)
      .post("/api/eligibility")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...MICHAEL_INPUTS, student_id: studentId });
    expect(attempt.statusCode).toBe(403);
  });
  test("Field Officers cannot recalculate or overwrite the saved assessment", async () => {
    const studentId = await createStudent();
    const first = await request(app)
      .patch(`/api/eligibility/${studentId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...MICHAEL_INPUTS, reason: "Verified original application values" });
    expect(first.statusCode).toBe(200);
    const denied = await request(app)
      .post("/api/eligibility")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({ fee_balance: 0, household_income: 90000, vulnerability_status: "low", siblings_in_school: 0, prior_bursary_history: "high", student_id: studentId });
    expect(denied.statusCode).toBe(403);
    expect(denied.body.code).toBe("ELIGIBILITY_ASSESSMENT_READ_ONLY");
    const stored = await pool.query("SELECT score, category FROM eligibility_assessments WHERE student_id = $1", [studentId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ score: 100, category: "high" });
  });

  test("invalid Admin correction values are rejected", async () => {
    const studentId = await createStudent();

    const negativeFee = await request(app).patch(`/api/eligibility/${studentId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fee_balance: -1000, reason: "Invalid fee correction" });
    expect(negativeFee.statusCode).toBe(400);

    const badVulnerability = await request(app).patch(`/api/eligibility/${studentId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ vulnerability_status: "severe", reason: "Invalid vulnerability correction" });
    expect(badVulnerability.statusCode).toBe(400);

    const badHistory = await request(app).patch(`/api/eligibility/${studentId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ prior_bursary_history: "sometimes", reason: "Invalid bursary correction" });
    expect(badHistory.statusCode).toBe(400);
  });
  test("an assessment is returned, stored on the student and recorded in the audit log", async () => {
    const studentId = await createStudent();

    const response = await request(app)
      .patch(`/api/eligibility/${studentId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...MICHAEL_INPUTS, reason: "Verified from supporting information" });

    expect(response.statusCode).toBe(200);
    expect(response.body.assessment.score).toBe(100);
    expect(response.body.assessment.category).toBe("high");
    expect(response.body.assessment.category_label).toBe("High");
    expect(response.body.assessment.recommended_range).toMatchObject({
      currency: "KES",
      min: 15000,
      max: 25000,
      provisional: true,
    });
    expect(response.body.assessment.inputs).toMatchObject(MICHAEL_INPUTS);

    const stored = await pool.query(
      "SELECT eligibility_score, eligibility_category, eligibility_assessed_at FROM students WHERE id = $1",
      [studentId]
    );
    expect(stored.rows[0].eligibility_score).toBe(100);
    expect(stored.rows[0].eligibility_category).toBe("high");
    expect(stored.rows[0].eligibility_assessed_at).not.toBeNull();

    const audit = await pool.query(
      `SELECT table_name, details FROM audit_logs
        WHERE user_id = $1 AND action = 'ELIGIBILITY_INPUTS_CORRECTED' AND record_id = $2`,
      [adminId, studentId]
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].table_name).toBe("students");
    expect(audit.rows[0].details.score).toBe(100);
    expect(audit.rows[0].details.category).toBe("high");
    expect(audit.rows[0].details.after).toMatchObject({
      fee_balance: 52000,
      household_income: 18000,
      vulnerability_status: "high",
      siblings_in_school: 4,
      prior_bursary_history: "none",
    });
  });

  test("an Admin correction appends assessment history instead of replacing it", async () => {
    const studentId = await createStudent({
      full_name: "Mary Wanjiku",
      school_code: "Maranda",
      upi: `UPI-WANJIKU-${Date.now()}`,
      birth_certificate_number: `BC-2020-${Date.now()}`,
    });

    const first = await request(app).patch(`/api/eligibility/${studentId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ ...MICHAEL_INPUTS, reason: "Verified initial values" });
    expect(first.statusCode).toBe(200);
    expect(first.body.assessment.category).toBe("high");

    const second = await request(app)
      .patch(`/api/eligibility/${studentId}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        fee_balance: 4000,
        household_income: 75000,
        vulnerability_status: "low",
        siblings_in_school: 1,
        prior_bursary_history: "high",
        reason: "Corrected values from reviewed information",
      });
    expect(second.statusCode).toBe(200);
    // 5 + 0 + 5 + 3 + 2 = 15
    expect(second.body.assessment.score).toBe(15);
    expect(second.body.assessment.category).toBe("low");
    expect(second.body.assessment.recommended_range).toMatchObject({ min: 3000, max: 8000 });

    const stored = await pool.query(
      "SELECT eligibility_score, eligibility_category FROM students WHERE id = $1",
      [studentId]
    );
    expect(stored.rows[0]).toEqual({ eligibility_score: 15, eligibility_category: "low" });

    const audits = await pool.query(
      `SELECT details FROM audit_logs
        WHERE user_id = $1 AND action = 'ELIGIBILITY_INPUTS_CORRECTED' AND record_id = $2
        ORDER BY created_at ASC`,
      [adminId, studentId]
    );
    expect(audits.rowCount).toBe(2);
    expect(audits.rows[0].details.score).toBe(100);
    expect(audits.rows[1].details.score).toBe(15);
  });
});
