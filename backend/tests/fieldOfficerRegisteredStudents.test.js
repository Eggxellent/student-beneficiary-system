const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../src/index");
const pool = require("../src/config/db");

// The Field Officer "Registered students" view is a server-side projection: only
// guardian-registered records with a cleared duplicate screen and a saved eligibility
// assessment are returned. These tests exercise the projection through the API, not the React
// table, so a direct call cannot obtain a wider list.
describe("Field Officer registered students", () => {
  jest.setTimeout(30000);
  const createdUserIds = [];
  const createdStudentIds = [];
  let officerToken;
  let officerId;
  let adminToken;
  let adminId;

  async function createUser(role, label) {
    const email = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
    const password = "TestPassword123!";
    const passwordHash = await bcrypt.hash(password, 4);
    const { rows } = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id",
      [`Registered Students ${label}`, email, passwordHash, role]
    );
    createdUserIds.push(rows[0].id);
    const login = await request(app)
      .post(`/api/auth/login/${role === "field_officer" ? "field-officer" : "admin"}`)
      .send({ email, password });
    return { id: rows[0].id, token: login.body.token };
  }

  async function createStudent(label, { guardianId } = {}) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { rows } = await pool.query(
      `INSERT INTO students (full_name, school_code, guardian_id, upi, birth_certificate_number)
       VALUES ($1, 'Nairobi School', $2, $3, $4) RETURNING id, full_name`,
      [
        `${label} ${suffix}`,
        guardianId === undefined ? `GUARD-${suffix}` : guardianId,
        `UPI-${suffix}`,
        `BC-${suffix}`,
      ]
    );
    createdStudentIds.push(rows[0].id);
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
       VALUES ($1, 'CREATE', 'students', $2, $3)`,
      [officerId, rows[0].id, { duplicate_model_version: 'test-screened', duplicate_flags_created: 0 }],
    );
    return rows[0];
  }

  async function assess(studentId, score, category) {
    await pool.query(
      `INSERT INTO eligibility_assessments (
         student_id, score, category, fee_balance, household_income, vulnerability_status,
         siblings_in_school, prior_bursary_history, recommended_min, recommended_max,
         recommended_currency, recommendation_provisional, recommendation_source,
         recorded_via, assessed_by
       ) VALUES ($1, $2, $3, 45000, 18000, 'high', 3, 'none', 20000, 30000,
                 'KSh', TRUE, 'Test fixture ranges', 'eligibility_form', $4)`,
      [studentId, score, category, officerId]
    );
  }

  async function award(studentId) {
    const { rows } = await pool.query(
      `INSERT INTO bursary_awards (student_id, school_code, requested_amount, submitted_by, award_year)
       VALUES ($1, 'Nairobi School', 20000, $2, EXTRACT(YEAR FROM NOW())::int) RETURNING id`,
      [studentId, officerId]
    );
    return rows[0].id;
  }

  async function flag(studentId, matchedStudentId, status) {
    const { rows } = await pool.query(
      `INSERT INTO duplicate_flags
         (student_id, matched_student_id, probability, status, model_version, review_threshold)
       VALUES ($1, $2, 0.91, $3, 'test-fixture', 0.75) RETURNING id`,
      [studentId, matchedStudentId, status]
    );
    return rows[0].id;
  }

  async function registeredStudents() {
    const response = await request(app)
      .get("/api/students/registered")
      .set("Authorization", `Bearer ${officerToken}`);
    expect(response.statusCode).toBe(200);
    return Array.isArray(response.body) ? response.body : response.body.value;
  }

  beforeAll(async () => {
    const officer = await createUser("field_officer", "officer");
    officerId = officer.id;
    officerToken = officer.token;
    const admin = await createUser("admin", "admin");
    adminId = admin.id;
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (createdStudentIds.length) {
      await pool.query(
        "DELETE FROM duplicate_resolutions WHERE canonical_student_id = ANY($1::uuid[]) OR duplicate_student_id = ANY($1::uuid[])",
        [createdStudentIds]
      );
      await pool.query(
        "DELETE FROM duplicate_review_events WHERE duplicate_flag_id IN (SELECT id FROM duplicate_flags WHERE student_id = ANY($1::uuid[]) OR matched_student_id = ANY($1::uuid[]))",
        [createdStudentIds]
      );
      await pool.query(
        "DELETE FROM duplicate_flags WHERE student_id = ANY($1::uuid[]) OR matched_student_id = ANY($1::uuid[])",
        [createdStudentIds]
      );
      await pool.query("DELETE FROM eligibility_assessments WHERE student_id = ANY($1::uuid[])", [createdStudentIds]);
      await pool.query("DELETE FROM bursary_awards WHERE student_id = ANY($1::uuid[])", [createdStudentIds]);
      await pool.query("DELETE FROM students WHERE id = ANY($1::uuid[])", [createdStudentIds]);
    }
    if (createdUserIds.length) {
      await pool.query("DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])", [createdUserIds]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdUserIds]);
    }
    await pool.end();
  });

  test("requires authentication", async () => {
    const response = await request(app).get("/api/students/registered");
    expect(response.statusCode).toBe(401);
  });

  test("returns only guardian-registered, duplicate-cleared, assessed students", async () => {
    const other = await createStudent("Neutral match");

    const eligible = await createStudent("Cleared and assessed");
    await assess(eligible.id, 82, "high");

    const pending = await createStudent("Pending review");
    await assess(pending.id, 70, "high");
    await flag(pending.id, other.id, "pending");

    const confirmed = await createStudent("Confirmed duplicate");
    await assess(confirmed.id, 65, "moderate");
    await flag(confirmed.id, other.id, "confirmed_duplicate");

    const unassessed = await createStudent("Awaiting assessment");

    const noGuardian = await createStudent("No guardian captured", { guardianId: null });
    await assess(noGuardian.id, 74, "high");

    const markedDuplicate = await createStudent("Marked as duplicate");
    await assess(markedDuplicate.id, 60, "moderate");
    await pool.query("UPDATE students SET duplicate_of_student_id = $1 WHERE id = $2", [eligible.id, markedDuplicate.id]);

    // A confirmed case the administrator resolved: the canonical record stays visible, the
    // record named as its duplicate does not.
    const canonical = await createStudent("Resolved canonical");
    await assess(canonical.id, 88, "high");
    const resolvedDuplicate = await createStudent("Resolved duplicate");
    const resolvedFlag = await flag(canonical.id, resolvedDuplicate.id, "confirmed_duplicate");
    await pool.query("UPDATE students SET duplicate_of_student_id = $1 WHERE id = $2", [canonical.id, resolvedDuplicate.id]);
    await pool.query(
      `INSERT INTO duplicate_resolutions (duplicate_flag_id, canonical_student_id, duplicate_student_id, reason, resolved_by)
       VALUES ($1, $2, $3, 'Verified same child through the source register', $4)`,
      [resolvedFlag, canonical.id, resolvedDuplicate.id, adminId]
    );

    const rows = await registeredStudents();
    const ids = rows.map((row) => row.id);

    expect(ids).toEqual(expect.arrayContaining([eligible.id, canonical.id]));
    for (const excluded of [
      pending.id,
      confirmed.id,
      unassessed.id,
      noGuardian.id,
      markedDuplicate.id,
      resolvedDuplicate.id,
    ]) {
      expect(ids).not.toContain(excluded);
    }
  });

  test("returns the assessment score, category, recommended range and status", async () => {
    const student = await createStudent("Assessment projection");
    await assess(student.id, 82, "high");

    const rows = await registeredStudents();
    const row = rows.find((item) => item.id === student.id);

    expect(row).toBeDefined();
    expect(row.full_name).toContain("Assessment projection");
    expect(Number(row.score)).toBe(82);
    expect(row.category).toBe("high");
    expect(Number(row.recommended_min)).toBe(20000);
    expect(Number(row.recommended_max)).toBe(30000);
    expect(row.recommended_currency).toBe("KSh");
    expect(row.recommendation_provisional).toBe(true);
    expect(row.assessed_at).toBeTruthy();
    expect(row.assessment_status).toBe("assessed");
    expect(row.duplicate_status).toBe("cleared");
    expect(row.guardian_id).toBeTruthy();
  });

  test("field officers still cannot record a duplicate review decision", async () => {
    const first = await createStudent("Review subject");
    const second = await createStudent("Review match");
    const flagId = await flag(first.id, second.id, "pending");

    const response = await request(app)
      .patch(`/api/duplicate-flags/${flagId}`)
      .set("Authorization", `Bearer ${officerToken}`)
      .send({ decision: "not_duplicate", reason: "Same household records reviewed at the school" });

    expect(response.statusCode).toBe(403);

    // The administrator retains the decision; clearing the case moves the record into the
    // registered list because an assessment already exists.
    await assess(first.id, 75, "high");
    const adminDecision = await request(app)
      .patch(`/api/duplicate-flags/${flagId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "not_duplicate", reason: "Same household records reviewed at the school" });
    expect(adminDecision.statusCode).toBe(200);

    const rows = await registeredStudents();
    expect(rows.map((row) => row.id)).toContain(first.id);
  });

  test("the full roster endpoint remains available for the assessment and award forms", async () => {
    const unassessed = await createStudent("Roster only");
    const response = await request(app)
      .get("/api/students")
      .set("Authorization", `Bearer ${officerToken}`);
    expect(response.statusCode).toBe(200);
    const roster = Array.isArray(response.body) ? response.body : response.body.value;
    expect(roster.map((row) => row.id)).toContain(unassessed.id);
  });

  test("a duplicate-pending student is withheld from the roster and cannot be read by id", async () => {
    const neutral = await createStudent("Access neutral");
    const cleared = await createStudent("Access cleared");
    const pending = await createStudent("Access pending");
    await flag(pending.id, neutral.id, "pending");

    const rosterResponse = await request(app).get("/api/students").set("Authorization", `Bearer ${officerToken}`);
    expect(rosterResponse.statusCode).toBe(200);
    const roster = Array.isArray(rosterResponse.body) ? rosterResponse.body : rosterResponse.body.value;
    const rosterIds = roster.map((row) => row.id);
    expect(rosterIds).toContain(cleared.id);
    expect(rosterIds).not.toContain(pending.id);

    // A record the roster hides must not be reachable by guessing its id.
    const hidden = await request(app).get(`/api/students/${pending.id}`).set("Authorization", `Bearer ${officerToken}`);
    expect(hidden.statusCode).toBe(404);

    const visible = await request(app).get(`/api/students/${cleared.id}`).set("Authorization", `Bearer ${officerToken}`);
    expect(visible.statusCode).toBe(200);
    expect(visible.body.id).toBe(cleared.id);
  });

  test("an award held by a duplicate-pending student is hidden from the Field Officer list only", async () => {
    const matched = await createStudent("Award matched");
    const clear = await createStudent("Award clear");
    const pending = await createStudent("Award pending");
    const clearAwardId = await award(clear.id);
    const pendingAwardId = await award(pending.id);
    await flag(pending.id, matched.id, "pending");

    const officerResponse = await request(app).get("/api/awards").set("Authorization", `Bearer ${officerToken}`);
    expect(officerResponse.statusCode).toBe(200);
    const officerIds = officerResponse.body.awards.map((row) => row.id);
    expect(officerIds).toContain(clearAwardId);
    expect(officerIds).not.toContain(pendingAwardId);

    // The administrator still sees the held award; hiding it would make the duplicate case
    // impossible to review from the award side.
    const adminResponse = await request(app).get("/api/awards").set("Authorization", `Bearer ${adminToken}`);
    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.body.awards.map((row) => row.id)).toContain(pendingAwardId);
  });

  test("a duplicate-pending student cannot be assessed or proposed for an award", async () => {
    const neutral = await createStudent("Blocked neutral");
    const pending = await createStudent("Blocked pending");
    await flag(pending.id, neutral.id, "needs_verification");

    const awardAttempt = await request(app)
      .post("/api/awards")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({ student_id: pending.id, requested_amount: 15000 });
    expect(awardAttempt.statusCode).toBe(409);
    expect(awardAttempt.body.code).toBe("ELIGIBILITY_BLOCKED_BY_DUPLICATE");

    const assessmentAttempt = await request(app)
      .post("/api/eligibility")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({
        student_id: pending.id,
        fee_balance: 45000,
        household_income: 18000,
        vulnerability_status: "high",
        siblings_in_school: 2,
        prior_bursary_history: "none",
      });
    expect(assessmentAttempt.statusCode).toBe(403);
    expect(assessmentAttempt.body.code).toBe("ELIGIBILITY_ASSESSMENT_READ_ONLY");
  });
});
