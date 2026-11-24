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
    return {
      full_name: "Jane Wanjiku",
      email: `guardian-${suffix}@example.com`,
      password,
      phone: "0712345678",
      national_id: `N${suffix.slice(0, 8).toUpperCase()}`,
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
      { national_id: "1234567890" }, // 10 digits
      { national_id: "ID-123456" }, // punctuation
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

    const idMessage = await attempt({ national_id: "1234567890" });
    expect(idMessage.body.error).toMatch(/at most 9/i);

    const accepted = await attempt({
      phone: "0711223344",
      national_id: String(Math.floor(100000000 + Math.random() * 899999999)),
      email: `guardian-gmail-${randomUUID().replace(/-/g, "").slice(0, 8)}@gmail.com`,
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.body.user.national_id).toMatch(/^\d{9}$/);
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

    const updated = await request(app)
      .patch("/api/guardian/me")
      .set("Authorization", `Bearer ${firstToken}`)
      .send({ phone: "0798765432" });

    expect(updated.statusCode).toBe(200);
    expect(updated.body.phone).toBe("0798765432");
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
    // No supporting documents are attached at initial submission: the payload deliberately omits
    // any documents key and the API must still accept and store the application.
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
    expect(response.body.application.documents).toEqual([]);
    applicationReference = response.body.application.reference;
    applicationId = response.body.application.id;
  });

  test("supporting documents attached to a submission are readable in the guardian's own record", async () => {
    const submitted = await request(app)
      .post("/api/guardian/applications")
      .set("Authorization", `Bearer ${firstToken}`)
      .send(
        applicationPayload({
          documents: [{ name: "birth-certificate.pdf", description: "Birth certificate" }],
        }),
      );

    // A resubmission of the same child is an idempotent retrieval, not a second application.
    expect(submitted.statusCode).toBe(200);
    expect(submitted.body.duplicate_submission).toBe(true);
    expect(submitted.body.application.statusKey).toBe("review");
    expect(submitted.body.application.documents).toEqual([
      { name: "birth-certificate.pdf", description: "Birth certificate" },
    ]);

    const fetched = await request(app)
      .get(`/api/guardian/applications/${submitted.body.application.reference}`)
      .set("Authorization", `Bearer ${firstToken}`);

    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.application.documents).toEqual([
      { name: "birth-certificate.pdf", description: "Birth certificate" },
    ]);
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

    const queue = await request(app)
      .get("/api/guardian/staff/applications")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(queue.statusCode).toBe(200);
    expect(queue.body.applications.some((row) => row.reference === applicationReference)).toBe(true);

    const decision = await request(app)
      .patch(`/api/guardian/staff/applications/${applicationId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "approved", note: "Household income verified." });

    expect(decision.statusCode).toBe(200);
    expect(decision.body.application.statusKey).toBe("approved");

    const refreshed = await request(app)
      .get(`/api/guardian/applications/${applicationReference}`)
      .set("Authorization", `Bearer ${firstToken}`);

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.body.application.statusKey).toBe("approved");
    expect(refreshed.body.application.decisionNote).toBe("Household income verified.");
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
