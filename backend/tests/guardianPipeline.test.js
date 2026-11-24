const request = require("supertest");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { randomUUID } = require("node:crypto");
const app = require("../src/index");
const pool = require("../src/config/db");

// bcrypt hashing plus the duplicate-screening query make the first request in this environment slow.
jest.setTimeout(30000);

// End-to-end guardian pipeline: submission -> student record -> duplicate screening ->
// automatic eligibility -> Field Officer visibility. Runs against the guarded sbms_test database.

describe("Guardian submission pipeline", () => {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const createdUserIds = [];
  const createdEmails = [];
  const identifier = `BC-${suffix.toUpperCase()}`;

  let guardianToken;
  let guardianUserId;
  let officerToken;
  let adminToken;
  let primaryStudentId;
  let primaryReference;
  let primarySchoolName;
  let candidateId;
  let flaggedStudentId;
  let flaggedFlagId;
  let secondFlaggedStudentId;
  let secondFlagId;

  async function createAccount(role, label) {
    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${suffix}@example.test`;
    createdEmails.push(email);
    const password_hash = await bcrypt.hash("TestPassword123!", 4);
    const { rows } = await pool.query(
      "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, role",
      [label, email, password_hash, role],
    );
    createdUserIds.push(rows[0].id);
    return jwt.sign({ id: rows[0].id, role }, process.env.JWT_SECRET, { expiresIn: "8h" });
  }

  function applicationPayload(overrides = {}) {
    return {
      student_full_name: `Pipeline Child ${suffix}`,
      student_date_of_birth: "2012-06-15",
      student_gender: "female",
      student_identifier: identifier,
      relationship_to_student: "Daughter",
      school_name: primarySchoolName,
      school_level: "secondary",
      admission_number: `ADM-${suffix}`,
      class_year: "Form 1",
      school_county: "Nairobi",
      guardian_full_name: `Pipeline Guardian ${suffix}`,
      guardian_phone: "0712345678",
      household_size: 4,
      income_source: "Small business",
      monthly_income: 18000,
      // The four inputs that complete the automatic assessment. With these values the engine scores
      // 25 (fee balance 45,000) + 25 (income 18,000) + 25 (high vulnerability) + 7 (three siblings)
      // + 10 (no prior bursary) = 92, which is the high band.
      fee_balance: 45000,
      vulnerability_status: "high",
      siblings_in_school: 3,
      prior_bursary_history: "none",
      declaration: true,
      ...overrides,
    };
  }

  function submit(payload) {
    return request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${guardianToken}`)
      .send(payload);
  }

  async function assessmentRows(studentId) {
    const { rows } = await pool.query(
      "SELECT status, score, category, missing_inputs, trigger FROM eligibility_assessments WHERE student_id = $1 ORDER BY created_at ASC",
      [studentId],
    );
    return rows;
  }

  beforeAll(async () => {
    primarySchoolName = `Pipeline School ${suffix}`;
    officerToken = await createAccount("field_officer", "Pipeline Officer");
    adminToken = await createAccount("admin", "Pipeline Admin");

    const registration = await request(app).post("/api/guardian/register").send({
      full_name: `Pipeline Guardian ${suffix}`,
      email: `pipeline-guardian-${suffix}@example.test`,
      password: "GuardianPass123!",
      phone: "0712345678",
      national_id: `N${suffix.slice(0, 8).toUpperCase()}`,
      relationship_to_student: "parent",
      privacy_consent: true,
    });
    createdEmails.push(`pipeline-guardian-${suffix}@example.test`);
    if (registration.statusCode !== 201 || !registration.body.token) {
      throw new Error(`Guardian registration failed: ${registration.statusCode} ${JSON.stringify(registration.body)}`);
    }
    if (registration.body.user?.id) {
      createdUserIds.push(registration.body.user.id);
      guardianUserId = registration.body.user.id;
    }
    guardianToken = registration.body.token;
  });

  test("an unflagged submission creates one linked student and a complete automatic assessment", async () => {
    const response = await submit(applicationPayload());

    expect(response.statusCode).toBe(201);
    expect(response.body.duplicate_submission).toBe(false);
    expect(response.body.application.reference).toMatch(/^APP-\d{4}-\d{5}$/);
    expect(response.body.student?.id).toBeTruthy();
    primaryStudentId = response.body.student.id;
    primaryReference = response.body.application.reference;

    // The guardian form now supplies every scoring input, so the assessment runs to completion at
    // registration: a real score and category, no missing inputs, no officer action.
    expect(response.body.assessment.status).toBe("complete");
    expect(response.body.assessment.score).toBe(92);
    expect(response.body.assessment.category).toBe("high");
    expect(response.body.assessment.missing_inputs).toEqual([]);

    const stored = await pool.query(
      `SELECT student_id, status, fee_balance, vulnerability_status, siblings_in_school,
              prior_bursary_history
         FROM guardian_applications WHERE reference = $1`,
      [primaryReference],
    );
    expect(stored.rows[0].student_id).toBe(primaryStudentId);
    expect(stored.rows[0].status).toBe("under_review");
    // Every submitted value is stored on the application, which is where the engine read it from.
    expect(Number(stored.rows[0].fee_balance)).toBe(45000);
    expect(stored.rows[0].vulnerability_status).toBe("high");
    expect(stored.rows[0].siblings_in_school).toBe(3);
    expect(stored.rows[0].prior_bursary_history).toBe("none");

    const students = await pool.query(
      "SELECT school_name, school_code, eligibility_score, eligibility_category FROM students WHERE id = $1",
      [primaryStudentId],
    );
    expect(students.rows[0].school_name).toBe(primarySchoolName);
    // The free-text name is not one of the five supported codes, so no code is invented.
    expect(students.rows[0].school_code).toBeNull();
    expect(students.rows[0].eligibility_score).toBe(92);
    expect(students.rows[0].eligibility_category).toBe("high");
  });

  test("the administrator queue reports the linked student, screening and assessment for each submission", async () => {
    const queue = await request(app)
      .get("/api/guardian/staff/applications")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(queue.statusCode).toBe(200);
    const row = queue.body.applications.find((item) => item.reference === primaryReference);
    expect(row).toBeTruthy();
    expect(row.student_id).toBe(primaryStudentId);
    expect(row.registeredStudent.id).toBe(primaryStudentId);
    expect(row.duplicate).toBeNull();
    expect(row.assessment.status).toBe("complete");
    expect(row.assessment.score).toBe(92);
    expect(row.assessment.missing_inputs).toEqual([]);
    expect(row.detail.student.name).toBe(`Pipeline Child ${suffix}`);
  });

  test("Field Officers cannot read the guardian application queue", async () => {
    const denied = await request(app)
      .get("/api/guardian/staff/applications")
      .set("Authorization", `Bearer ${officerToken}`);

    expect(denied.statusCode).toBe(403);
  });

  test("resubmitting the same child is idempotent: same application, same student, one assessment", async () => {
    const before = await pool.query("SELECT COUNT(*)::int AS total FROM students WHERE guardian_id = $1", [guardianUserId]);

    const response = await submit(applicationPayload({
      documents: [{ name: "report-card.pdf", description: "Report" }],
    }));

    expect(response.statusCode).toBe(200);
    expect(response.body.duplicate_submission).toBe(true);
    expect(response.body.application.reference).toBe(primaryReference);
    expect(response.body.student.id).toBe(primaryStudentId);
    expect(response.body.assessment.status).toBe("complete");

    const after = await pool.query("SELECT COUNT(*)::int AS total FROM students WHERE guardian_id = $1", [guardianUserId]);
    expect(after.rows[0].total).toBe(before.rows[0].total);

    // One triggering event, one assessment row even though the submission was repeated.
    const assessments = await assessmentRows(primaryStudentId);
    expect(assessments.filter((row) => row.trigger === "registration_screening")).toHaveLength(1);
  });

  test("the automatic assessment is the Field Officer finding: no manual entry is needed", async () => {
    const registered = await request(app)
      .get("/api/students/registered")
      .set("Authorization", `Bearer ${officerToken}`);

    expect(registered.statusCode).toBe(200);
    const listed = registered.body.find((student) => student.id === primaryStudentId);
    expect(listed).toBeTruthy();
    expect(listed.assessment_status).toBe("assessed");
    expect(listed.duplicate_status).toBe("cleared");
    expect(listed.score).toBe(92);
    expect(listed.category).toBe("high");
    expect(Number(listed.recommended_min)).toBeGreaterThanOrEqual(0);
    expect(Number(listed.recommended_max)).toBeGreaterThanOrEqual(Number(listed.recommended_min));

    // Nothing about this student needs attention after the automatic assessment.
    const overview = await request(app)
      .get("/api/students/registered/overview")
      .set("Authorization", `Bearer ${officerToken}`);

    expect(overview.statusCode).toBe(200);
    expect(overview.body.needs_attention.map((student) => student.id)).not.toContain(primaryStudentId);
    expect(overview.body.recent_registrations.map((student) => student.id)).toContain(primaryStudentId);
    expect(overview.body.metrics.registered_students).toBeGreaterThanOrEqual(1);

    // Student registration is guardian-only; the Field Officer route no longer exists.
    const rejected = await request(app)
      .post("/api/students")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({ full_name: "Field Officer Registration Attempt" });
    expect(rejected.statusCode).toBe(404);
  });

  test("the read-only findings projection carries the guardian submission and the assessment state", async () => {
    const response = await request(app)
      .get("/api/students/eligibility-findings")
      .set("Authorization", `Bearer ${officerToken}`);

    expect(response.statusCode).toBe(200);
    const record = response.body.find((student) => student.id === primaryStudentId);
    expect(record).toBeTruthy();

    // The guardian typed a school name that matches no configured code. The findings screen must
    // still show that name instead of "Not recorded", and the application it came from stays linked.
    expect(record.school).toBe(primarySchoolName);
    expect(record.application.reference).toBe(primaryReference);
    expect(Number(record.application.monthly_income)).toBe(18000);

    // The assessment shown is the one the engine saved at registration, not a recomputed value.
    expect(record.assessment.status).toBe("complete");
    expect(record.assessment.score).toBe(92);
    expect(record.assessment.category).toBe("high");
    expect(record.assessment.missing_inputs).toEqual([]);
    expect(Number(record.assessment.inputs.fee_balance)).toBe(45000);
    expect(Number(record.assessment.inputs.household_income)).toBe(18000);
    expect(record.assessment.inputs.vulnerability_status).toBe("high");
    expect(record.assessment.inputs.siblings_in_school).toBe(3);
    expect(record.assessment.inputs.prior_bursary_history).toBe("none");
    expect(Number(record.application.fee_balance)).toBe(45000);
  });

  test("a submission matching an existing child is blocked from assessment and hidden from the officer", async () => {
    const candidate = await pool.query(
      `INSERT INTO students (full_name, date_of_birth, school_code, school_name, birth_certificate_number)
       VALUES ($1, $2, 'Nairobi School', 'Nairobi School', $3) RETURNING id`,
      [`Pipeline Existing ${suffix}`, "2011-03-09", `EXIST-${suffix}`],
    );
    candidateId = candidate.rows[0].id;

    const response = await submit(applicationPayload({
      student_full_name: `Pipeline Existing ${suffix}`,
      student_date_of_birth: "2011-03-09",
      student_identifier: `EXIST-${suffix}`,
      school_name: "Nairobi School",
    }));

    expect(response.statusCode).toBe(201);
    flaggedStudentId = response.body.student.id;
    expect(response.body.assessment.status).toBe("blocked");
    expect(response.body.duplicate_screening.flagged).toBe(true);
    expect(await assessmentRows(flaggedStudentId)).toHaveLength(0);

    const flags = await pool.query(
      "SELECT id, status FROM duplicate_flags WHERE student_id = $1 ORDER BY created_at DESC",
      [flaggedStudentId],
    );
    expect(flags.rows.length).toBeGreaterThanOrEqual(1);
    expect(flags.rows[0].status).toBe("pending");
    flaggedFlagId = flags.rows[0].id;

    const overview = await request(app)
      .get("/api/students/registered/overview")
      .set("Authorization", `Bearer ${officerToken}`);
    expect(overview.body.needs_attention.map((student) => student.id)).not.toContain(flaggedStudentId);
    expect(overview.body.recent_registrations.map((student) => student.id)).not.toContain(flaggedStudentId);
  });

  test("an administrator clearing the case records the clearance assessment", async () => {
    const decision = await request(app)
      .patch(`/api/duplicate-flags/${flaggedFlagId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "not_duplicate", reason: "Source documents verified as two different children." });

    expect(decision.statusCode).toBe(200);
    expect(decision.body.flag.status).toBe("not_duplicate");
    // The application already holds every scoring input, so clearance completes the assessment
    // immediately instead of leaving it for an officer.
    expect(decision.body.automatic_assessment.status).toBe("complete");
    expect(decision.body.automatic_assessment.score).toBe(92);

    const clearance = (await assessmentRows(flaggedStudentId)).filter((row) => row.trigger === "duplicate_clearance");
    expect(clearance).toHaveLength(1);
    expect(clearance[0].status).toBe("complete");
    expect(clearance[0].score).toBe(92);
  });

  test("the officer's manual assessment endpoint is not needed for a guardian registration", async () => {
    // Automatic scoring already stored the finding, so the record is assessed without any POST. The
    // endpoint still exists for records that predate the pipeline, but the guardian flow never needs
    // it and must not produce a second assessment row for the same registration event.
    const registered = await request(app)
      .get("/api/students/registered")
      .set("Authorization", `Bearer ${officerToken}`);
    const listed = registered.body.find((student) => student.id === primaryStudentId);
    expect(listed).toBeTruthy();
    expect(listed.assessment_status).toBe("assessed");
    expect(listed.score).toBe(92);

    const assessments = await assessmentRows(primaryStudentId);
    expect(assessments.filter((row) => row.trigger === "registration_screening")).toHaveLength(1);
  });

  test("a confirmed duplicate keeps the student blocked and manual eligibility returns 409", async () => {
    // Reusing the first child's birth certificate number is an exact identifier match.
    const response = await submit(applicationPayload({
      student_full_name: `Pipeline Duplicate ${suffix}`,
      student_date_of_birth: "2013-01-20",
      student_identifier: identifier,
    }));

    expect(response.statusCode).toBe(201);
    secondFlaggedStudentId = response.body.student.id;
    expect(response.body.assessment.status).toBe("blocked");

    const flags = await pool.query(
      "SELECT id FROM duplicate_flags WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1",
      [secondFlaggedStudentId],
    );
    secondFlagId = flags.rows[0].id;

    const decision = await request(app)
      .patch(`/api/duplicate-flags/${secondFlagId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "confirmed_duplicate", reason: "Same birth certificate number, same child." });
    expect(decision.statusCode).toBe(200);

    const eligibility = await request(app)
      .post("/api/eligibility")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({
        student_id: secondFlaggedStudentId,
        fee_balance: 20000,
        household_income: 18000,
        vulnerability_status: "high",
        siblings_in_school: 2,
        prior_bursary_history: "none",
      });

    expect(eligibility.statusCode).toBe(409);
    expect(eligibility.body.code).toBe("ELIGIBILITY_BLOCKED_BY_DUPLICATE");
    expect(await assessmentRows(secondFlaggedStudentId)).toHaveLength(0);

    // A confirmed duplicate also holds the matched child: the case is unresolved for both records
    // until an administrator records a resolution.
    const matched = await request(app)
      .post("/api/eligibility")
      .set("Authorization", `Bearer ${officerToken}`)
      .send({
        student_id: primaryStudentId,
        fee_balance: 45000,
        household_income: 18000,
        vulnerability_status: "high",
        siblings_in_school: 3,
        prior_bursary_history: "none",
      });
    expect(matched.statusCode).toBe(409);
    expect(matched.body.code).toBe("ELIGIBILITY_BLOCKED_BY_DUPLICATE");
  });

  test("clearing a case between two guardian-registered students assesses the newly flagged record", async () => {
    // Both sides have a guardian, so preferring \"the side with a guardian\" is ambiguous. The
    // flagged side is the guardian's own new submission and is the record that needs the clearance
    // assessment; the canonical side already has its own.
    const secondGuardianEmail = `pipeline-guardian2-${suffix}@example.test`;
    createdEmails.push(secondGuardianEmail);
    const secondGuardian = await pool.query(
      `INSERT INTO users (full_name, email, password_hash, role, phone, national_id)
       VALUES ($1, $2, $3, 'guardian', '0700000002', $4) RETURNING id`,
      [`Pipeline Second Guardian ${suffix}`, secondGuardianEmail, await bcrypt.hash("GuardianPass123!", 4), `G2-${suffix.toUpperCase()}`],
    );
    createdUserIds.push(secondGuardian.rows[0].id);

    const canonical = await pool.query(
      `INSERT INTO students (full_name, date_of_birth, school_code, school_name, birth_certificate_number, guardian_id)
       VALUES ($1, '2013-04-11', 'Nairobi School', 'Nairobi School', $2, $3) RETURNING id`,
      [`Pipeline Shared Name ${suffix}`, `CANON-${suffix}`, guardianUserId],
    );
    const newlyFlagged = await pool.query(
      `INSERT INTO students (full_name, date_of_birth, school_code, school_name, birth_certificate_number, guardian_id)
       VALUES ($1, '2013-04-11', 'Nairobi School', 'Nairobi School', $2, $3) RETURNING id`,
      [`Pipeline Shared Name ${suffix}`, `CANON-OTHER-${suffix}`, secondGuardian.rows[0].id],
    );
    const flagRow = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status, model_version, review_threshold)
       VALUES ($1, $2, 0.86, 'pending', 'test-fixture', 0.75) RETURNING id`,
      [newlyFlagged.rows[0].id, canonical.rows[0].id],
    );

    const decision = await request(app)
      .patch(`/api/duplicate-flags/${flagRow.rows[0].id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ decision: "not_duplicate", reason: "Two children sharing a name, confirmed by the school register." });
    expect(decision.statusCode).toBe(200);

    const clearance = await pool.query(
      "SELECT student_id FROM eligibility_assessments WHERE trigger = 'duplicate_clearance' AND trigger_reference = $1",
      [flagRow.rows[0].id],
    );
    expect(clearance.rows).toHaveLength(1);
    expect(clearance.rows[0].student_id).toBe(newlyFlagged.rows[0].id);
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
      if (createdUserIds.length) {
        await attemptCleanup("audit cleanup", () => pool.query(
          "DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])",
          [createdUserIds],
        ));
        await attemptCleanup("application cleanup", () => pool.query(
          "DELETE FROM guardian_applications WHERE user_id = ANY($1::uuid[])",
          [createdUserIds],
        ));
        // Cascades the eligibility assessments, duplicate flags and review events of these students.
        await attemptCleanup("student cleanup", () => pool.query(
          "DELETE FROM students WHERE guardian_id = ANY($1::text[])",
          [createdUserIds],
        ));
      }
      if (candidateId) {
        await attemptCleanup("candidate cleanup", () => pool.query(
          "DELETE FROM students WHERE id = $1",
          [candidateId],
        ));
      }
      if (createdUserIds.length) {
        await attemptCleanup("user cleanup", () => pool.query(
          "DELETE FROM users WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])",
          [createdUserIds, createdEmails],
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



