const request = require("supertest");
const bcrypt = require("bcrypt");
const { randomUUID } = require("node:crypto");
const app = require("../src/index");
const pool = require("../src/config/db");
const Auth = require("../src/models/auth.model");

// Guardian surface: self-registration, shared sign-in, ownership isolation and the
// guardian-scoped application endpoints. Every assertion runs against the provisioned
// sbms_test database guarded by tests/testDatabaseGuard.js.

// Submission now runs duplicate screening and stores an automatic assessment, which is slower than
// the default jest budget on this machine.
jest.setTimeout(30000);

describe("Guardian API", () => {
  const password = "GuardianPass123!";
  const createdEmails = [];
  const createdUserIds = [];

  function registrationPayload(overrides = {}) {
    const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
    const nationalId = String(Number.parseInt(suffix.slice(0, 8), 16) % 100_000_000).padStart(8, "0");
    return {
      full_name: "Jane Wanjiku",
      email: `guardian-${suffix}@example.com`,
      password,
      phone: "0712345678",
      national_id: nationalId,
      relationship_to_student: "parent",
      privacy_consent: true,
      ...overrides,
    };
  }

  const firstGuardian = registrationPayload();
  const secondGuardian = registrationPayload();
  let firstToken;
  let secondToken;
  let applicationReference;
  let applicationId;

  async function registerGuardianAccount(payload) {
    const response = await request(app).post("/api/guardian/register").send(payload);
    createdEmails.push(payload.email);
    if (response.body.user?.id) createdUserIds.push(response.body.user.id);
    return response;
  }

  test("self-registration creates a guardian account and returns a token", async () => {
    const response = await registerGuardianAccount(firstGuardian);

    expect(response.statusCode).toBe(201);
    expect(response.body.user.role).toBe("guardian");
    expect(typeof response.body.token).toBe("string");
    expect(response.body.user.password_hash).toBeUndefined();
    expect(response.body.user.national_id).toBeUndefined();
    firstToken = response.body.token;
  });

  test("registration rejects a duplicate email and missing consent", async () => {
    const duplicate = await request(app)
      .post("/api/guardian/register")
      .send({ ...registrationPayload(), email: firstGuardian.email });

    expect(duplicate.statusCode).toBe(409);

    const noConsent = await registerGuardianAccount(
      registrationPayload({ privacy_consent: false }),
    );
    expect(noConsent.statusCode).toBe(400);
  });

  test("self-registration enforces the published field rules", async () => {
    const guardianRegistrationRateLimit = require("../src/middleware/guardianRegistrationRateLimit");
    // This case deliberately sends many requests from one IP; the limiter has its own test file.
    const attempt = (overrides) => {
      guardianRegistrationRateLimit.reset();
      return registerGuardianAccount(registrationPayload(overrides));
    };

    const invalidCases = [
      { phone: "071234567" }, // 9 digits
      { phone: "07123456789" }, // 11 digits
      { phone: "071234567x" }, // letters
      { phone: "" }, // required
      { national_id: "1234567" }, // 7 digits
      { national_id: "123456789" }, // 9 digits
      { national_id: "1234 5678" }, // whitespace
      { national_id: "1234-5678" }, // punctuation
      { national_id: "1234567a" }, // letters
      { national_id: 12345678 }, // numeric JSON value must not be converted to a string
      { national_id: "" }, // required
      { password: "short7!" }, // under 8 characters
      { email: "" }, // required
      { email: "not-an-email" }, // format
      { full_name: "" }, // required
    ];

    for (const overrides of invalidCases) {
      const response = await attempt(overrides);
      expect({ overrides, status: response.statusCode }).toEqual({ overrides, status: 400 });
      expect(response.body.user).toBeUndefined();
      expect(typeof response.body.error).toBe("string");
      expect(response.body.error.length).toBeGreaterThan(0);
    }

    const phoneMessage = await attempt({ phone: "071234567" });
    expect(phoneMessage.body.error).toMatch(/exactly 10 digits/i);

    const idMessage = await attempt({ national_id: "1234 5678" });
    expect(idMessage.body.error).toMatch(/exactly 8 digits/i);

    const leadingZeroId = `0${String(Number.parseInt(randomUUID().replace(/-/g, "").slice(0, 7), 16) % 10_000_000).padStart(7, "0")}`;
    const accepted = await attempt({
      phone: "0711223344",
      national_id: leadingZeroId,
      email: `guardian-gmail-${randomUUID().replace(/-/g, "").slice(0, 8)}@gmail.com`,
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.body.user.national_id).toBeUndefined();
    const acceptedProfile = await request(app)
      .get("/api/guardian/me")
      .set("Authorization", `Bearer ${accepted.body.token}`);
    expect(acceptedProfile.statusCode).toBe(200);
    expect(acceptedProfile.body.national_id).toBe(leadingZeroId);
  });

  test("a guardian signs in through the shared login endpoint", async () => {
    const response = await request(app)
      .post("/api/auth/login")
      .send({ email: firstGuardian.email, password });

    expect(response.statusCode).toBe(200);
    expect(response.body.user.role).toBe("guardian");
    expect(typeof response.body.token).toBe("string");
  });

  test("guardian tokens are refused by staff-only endpoints", async () => {
    const response = await request(app)
      .get("/api/audit-logs")
      .set("Authorization", `Bearer ${firstToken}`);

    expect(response.statusCode).toBe(403);
  });

  test("guardian endpoints reject anonymous requests", async () => {
    const response = await request(app).get("/api/guardian/applications");
    expect(response.statusCode).toBe(401);
  });

  test("profile reads and updates only the signed-in guardian", async () => {
    const profile = await request(app)
      .get("/api/guardian/me")
      .set("Authorization", `Bearer ${firstToken}`);

    expect(profile.statusCode).toBe(200);
    expect(profile.body.email).toBe(firstGuardian.email);
    expect(profile.body.national_id).toBe(firstGuardian.national_id);

    const authProfile = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${firstToken}`);
    expect(authProfile.statusCode).toBe(200);
    expect(authProfile.body.national_id).toBeUndefined();

    const updated = await request(app)
      .patch("/api/guardian/me")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ phone: "0798765432" });

    expect(updated.statusCode).toBe(200);
    expect(updated.body.phone).toBe("0798765432");

    for (const national_id of ["1234567", "123456789", "1234 5678", "1234-5678", "1234567a"]) {
      const invalid = await request(app)
        .patch("/api/guardian/me")
        .set("Authorization", `Bearer ${firstToken}`)
        .send({ national_id });
      expect(invalid.statusCode).toBe(400);
    }
  });


  function applicationPayload(overrides = {}) {
    return {
      student_full_name: "Mary Wanjiku",
      student_date_of_birth: "2010-04-12",
      student_gender: "female",
      student_identifier: "STU-0001",
      relationship_to_student: "Daughter",
      school_name: "Nairobi Girls High School",
      school_level: "secondary",
      admission_number: "ADM-0001",
      class_year: "Form 2",
      school_county: "Nairobi",
      guardian_full_name: "Jane Wanjiku",
      guardian_phone: "0712345678",
      household_size: 5,
      income_source: "Small business",
      monthly_income: 25000,
      fee_balance: 32000,
      vulnerability_status: "high",
      siblings_in_school: 2,
      prior_bursary_history: "none",
      declaration: true,
      ...overrides,
    };
  }

  test("a guardian submits a bursary application with a generated reference", async () => {
    const response = await request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(applicationPayload());

    expect(response.statusCode).toBe(201);
    expect(response.body.application.reference).toMatch(/^APP-\d{4}-\d{5}$/);
    // Submission itself moves the application to Under Review. Duplicate screening (when it
    // applies) is tracked separately and never sets the application status.
    expect(response.body.application.statusKey).toBe("review");
    expect(response.body.application.status).toBe("Under Review");
    expect(response.body.application.status_code).toBe("under_review");
    expect(response.body.application.duplicateScreeningStatus).toBe("cleared");
    expect(response.body.application.documents).toBeUndefined();
    applicationReference = response.body.application.reference;
    applicationId = response.body.application.id;
  });

  test("a Guardian can download only their own application submission receipt", async () => {
    const receipt = await request(app)
      .get(`/api/guardian/applications/${applicationReference}/receipt.pdf`)
      .set("Authorization", `Bearer ${firstToken}`)
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => callback(null, Buffer.concat(chunks)));
      });

    expect(receipt.statusCode).toBe(200);
    expect(receipt.headers["content-type"]).toMatch(/application\/pdf/);
    expect(receipt.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(receipt.body.toString("utf8")).not.toContain(firstGuardian.national_id);

    const otherAccount = await registerGuardianAccount(registrationPayload());
    expect(otherAccount.statusCode).toBe(201);
    const otherGuardian = await request(app)
      .get(`/api/guardian/applications/${applicationReference}/receipt.pdf`)
      .set("Authorization", `Bearer ${otherAccount.body.token}`);
    expect(otherGuardian.statusCode).toBe(404);
  });

  test("obsolete supporting-document payloads are not stored or exposed", async () => {
    const submitted = await request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(
        applicationPayload({
          documents: [{ name: "birth-certificate.pdf", description: "Birth certificate" }],
        }),
      );

    expect(submitted.statusCode).toBe(200);
    expect(submitted.body.duplicate_submission).toBe(true);
    expect(submitted.body.application.statusKey).toBe("review");
    expect(submitted.body.application.documents).toBeUndefined();

    const fetched = await request(app)
      .get(`/api/guardian/applications/${submitted.body.application.reference}`)
      .set("Authorization", `Bearer ${firstToken}`);

    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.application.documents).toBeUndefined();
    const stored = await pool.query("SELECT details FROM guardian_applications WHERE id = $1", [applicationId]);
    expect(stored.rows[0].details).toEqual({});
  });

  test("application submission validates required fields and the declaration", async () => {
    const missingDeclaration = await request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(applicationPayload({ declaration: false }));

    expect(missingDeclaration.statusCode).toBe(400);

    const missingStudent = await request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(applicationPayload({ student_full_name: "" }));

    expect(missingStudent.statusCode).toBe(400);

    const missingSchool = await request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(applicationPayload({ school_name: "" }));

    expect(missingSchool.statusCode).toBe(400);
  });

  test("the four eligibility inputs are validated and stored with the application", async () => {
    const rejected = [
      ["negative fee balance", { fee_balance: -1 }],
      ["missing fee balance", { fee_balance: "" }],
      ["unknown vulnerability level", { vulnerability_status: "severe" }],
      ["missing vulnerability level", { vulnerability_status: "" }],
      ["missing siblings", { siblings_in_school: "" }],
      ["fractional siblings", { siblings_in_school: 1.5 }],
      ["negative siblings", { siblings_in_school: -2 }],
      ["unknown prior bursary answer", { prior_bursary_history: "yes" }],
    ];

    for (const [label, overrides] of rejected) {
      const response = await request(app)
        .post("/api/guardian/applications")
        .set("Authorization", `Bearer ${firstToken}`)
        .send(applicationPayload(overrides));
      expect([label, response.statusCode]).toEqual([label, 400]);
    }

    const stored = await pool.query(
      `SELECT fee_balance, vulnerability_status, siblings_in_school, prior_bursary_history
         FROM guardian_applications WHERE reference = $1`,
      [applicationReference],
    );
    expect(Number(stored.rows[0].fee_balance)).toBe(32000);
    expect(stored.rows[0].vulnerability_status).toBe("high");
    expect(stored.rows[0].siblings_in_school).toBe(2);
    expect(stored.rows[0].prior_bursary_history).toBe("none");

    // The guardian's own record shows the submitted values back to them.
    const own = await request(app)
      .get(`/api/guardian/applications/${applicationReference}`)
      .set("Authorization", `Bearer ${firstToken}`);
    expect(own.statusCode).toBe(200);
    expect(own.body.application.household.feeBalance).toBe("KES 32,000");
    expect(own.body.application.household.vulnerabilityStatus).toBe("High");
    expect(own.body.application.household.siblingsInSchool).toBe("2");
    expect(own.body.application.household.priorBursaryHistory).toBe("No previous bursary");
  });


  test("guardians can only read their own applications", async () => {
    const own = await request(app)
      .get(`/api/guardian/applications/${applicationReference}`)
      .set("Authorization", `Bearer ${firstToken}`);

    expect(own.statusCode).toBe(200);
    expect(own.body.application.student.name).toBe("Mary Wanjiku");
    expect(own.body.application.household.phone).toBe("0712345678");

    const second = await registerGuardianAccount(secondGuardian);
    expect(second.statusCode).toBe(201);
    secondToken = second.body.token;

    const foreign = await request(app)
      .get(`/api/guardian/applications/${applicationReference}`)
      .set("Authorization", `Bearer ${secondToken}`);

    expect(foreign.statusCode).toBe(404);

    const foreignList = await request(app)
      .get("/api/guardian/applications")
      .set("Authorization", `Bearer ${secondToken}`);

    expect(foreignList.statusCode).toBe(200);
    expect(foreignList.body.applications).toHaveLength(0);
  });

  test("the dashboard reports guardian-scoped application counts", async () => {
    const response = await request(app)
      .get("/api/guardian/dashboard")
      .set("Authorization", `Bearer ${firstToken}`);

    expect(response.statusCode).toBe(200);
    expect(response.body.guardian.email).toBe(firstGuardian.email);
    expect(response.body.summary.total).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.review).toBeGreaterThanOrEqual(1);
    expect(response.body.summary.submitted).toBe(0);
    expect(response.body.applications.length).toBeGreaterThanOrEqual(1);
    expect(response.body.applications[0].statusKey).toBe("review");
  });

  test("guardian tokens cannot use the staff review endpoints", async () => {
    const queue = await request(app)
      .get("/api/guardian/staff/applications")
      .set("Authorization", `Bearer ${firstToken}`);

    expect(queue.statusCode).toBe(403);

    const decision = await request(app)
      .patch(`/api/guardian/staff/applications/${applicationId}/status`)
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ status: "approved" });

    expect(decision.statusCode).toBe(403);
  });

  test("an administrator decision is reflected on the guardian application", async () => {
    const password_hash = await bcrypt.hash(password, 12);
    const admin = await Auth.createUser({
      full_name: "Guardian Reviewer",
      email: `guardian-reviewer-${randomUUID()}@example.com`,
      password_hash,
      role: "admin",
    });
    createdUserIds.push(admin.id);
    createdEmails.push(admin.email);

    const signIn = await request(app)
      .post("/api/auth/login")
      .send({ email: admin.email, password });

    expect(signIn.statusCode).toBe(200);
    const adminToken = signIn.body.token;

    const application = await pool.query(
      "SELECT student_id FROM guardian_applications WHERE id = $1",
      [applicationId],
    );
    const matched = await pool.query(
      "INSERT INTO students (full_name) VALUES ($1) RETURNING id",
      [`Pending match ${randomUUID()}`],
    );
    const pendingFlag = await pool.query(
      `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
       VALUES ($1, $2, 0.9, 'pending') RETURNING id`,
      [application.rows[0].student_id, matched.rows[0].id],
    );
    const blockedApproval = await request(app)
      .patch(`/api/guardian/staff/applications/${applicationId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved", note: "Cannot bypass duplicate review." });
    expect(blockedApproval.statusCode).toBe(409);
    expect(blockedApproval.body.code).toBe("DUPLICATE_REVIEW_REQUIRED");
    await pool.query("DELETE FROM duplicate_flags WHERE id = $1", [pendingFlag.rows[0].id]);
    await pool.query("DELETE FROM students WHERE id = $1", [matched.rows[0].id]);

    const queue = await request(app)
      .get("/api/guardian/staff/applications")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(queue.statusCode).toBe(200);
    expect(queue.body.applications.some((row) => row.reference === applicationReference)).toBe(true);

    const decision = await request(app)
      .patch(`/api/guardian/staff/applications/${applicationId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "rejected", note: "Household income did not meet the programme criteria." });

    expect(decision.statusCode).toBe(200);
    expect(decision.body.application.statusKey).toBe("rejected");

    const refreshed = await request(app)
      .get(`/api/guardian/applications/${applicationReference}`)
      .set("Authorization", `Bearer ${firstToken}`);

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.body.application.statusKey).toBe("rejected");
    expect(refreshed.body.application.decisionNote).toBe("Household income did not meet the programme criteria.");
    expect(refreshed.body.application.rejectionMessage).toBe(
      "Your application was unsuccessful. If you have any questions or need clarification, please contact our support team. You may also submit a new application.",
    );

    const reopen = await request(app)
      .patch(`/api/guardian/staff/applications/${applicationId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "under_review" });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.body.code).toBe("REJECTED_APPLICATION_READ_ONLY");

    const rejectedStudent = await pool.query("SELECT student_id FROM guardian_applications WHERE id = $1", [applicationId]);
    const correction = await request(app)
      .patch(`/api/eligibility/${rejectedStudent.rows[0].student_id}/correction`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ fee_balance: 1000, reason: "Attempt to alter rejected application" });
    expect(correction.statusCode).toBe(409);
    expect(correction.body.code).toBe("REJECTED_APPLICATION_READ_ONLY");

    const resubmission = await request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(applicationPayload());
    expect(resubmission.statusCode).toBe(201);
    expect(resubmission.body.application.statusKey).toBe("review");
    expect(resubmission.body.student).toBeTruthy();
    expect(resubmission.body.application.duplicateScreeningStatus).toBe("under_review");
    const duplicateFlags = await pool.query("SELECT id FROM duplicate_flags WHERE student_id = $1", [resubmission.body.student.id]);
    expect(duplicateFlags.rows.length).toBeGreaterThan(0);
    const screeningAudit = await pool.query(
      `SELECT 1 FROM audit_logs
        WHERE action = 'GUARDIAN_APPLICATION_LINKED_STUDENT' AND record_id = $1`,
      [resubmission.body.application.id],
    );
    expect(screeningAudit.rows).toHaveLength(1);

    const preserved = await pool.query("SELECT status, decision_note FROM guardian_applications WHERE id = $1", [applicationId]);
    expect(preserved.rows[0]).toEqual({
      status: "rejected",
      decision_note: "Household income did not meet the programme criteria.",
    });
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
      if (createdUserIds.length || createdEmails.length) {
        await attemptCleanup("audit-row cleanup", () => pool.query(
          `DELETE FROM audit_logs
            WHERE user_id = ANY($1::uuid[])
               OR record_id IN (SELECT id FROM guardian_applications WHERE user_id = ANY($1::uuid[]))`,
          [createdUserIds]
        ));
        await attemptCleanup("application cleanup", () => pool.query(
          "DELETE FROM guardian_applications WHERE user_id = ANY($1::uuid[])",
          [createdUserIds]
        ));
        await attemptCleanup("student cleanup", () => pool.query(
          "DELETE FROM students WHERE guardian_id = ANY($1::text[])",
          [createdUserIds]
        ));
        await attemptCleanup("user cleanup", () => pool.query(
          "DELETE FROM users WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])",
          [createdUserIds, createdEmails]
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
