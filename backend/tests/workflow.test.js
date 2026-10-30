const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../src/index");
const pool = require("../src/config/db");

const created = { users: [], students: [] };

async function createUser(role, label) {
  // The login endpoint lower-cases the address it looks up, so the stored value must be
  // lower-case too; students.test.js gets away with it only because its label is already
  // lower-case.
  const email = `${label}${Date.now()}@example.com`.toLowerCase();
  const password = "TestPassword123!";
  const passwordHash = await bcrypt.hash(password, 12);
  const { rows } = await pool.query(
    "INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, true) RETURNING id",
    [label, email, passwordHash, role]
  );
  created.users.push(rows[0].id);
  const path = role === "admin" ? "/api/auth/login/admin" : "/api/auth/login/field-officer";
  const login = await request(app).post(path).send({ email, password });
  if (!login.body.token) throw new Error(`${label} could not sign in: ${login.statusCode}`);
  return { id: rows[0].id, token: login.body.token, email };
}

let officer;
let admin;

async function registerStudent(overrides) {
  const response = await request(app)
    .post("/api/students")
    .set("Authorization", `Bearer ${officer.token}`)
    .send({
      date_of_birth: "2010-03-11",
      school_code: "Nairobi School",
      primary_phone: "+254700111222",
      ...overrides,
    });
  if (response.statusCode !== 201) {
    throw new Error(`registration failed: ${response.statusCode} ${JSON.stringify(response.body)}`);
  }
  created.students.push(response.body.student.id);
  return response.body;
}

const auth = (actor) => ({ Authorization: `Bearer ${actor.token}` });

async function createVerifiedAward(studentId, amount, officerToken) {
  const award = await request(app)
    .post("/api/awards")
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ student_id: studentId, requested_amount: amount });
  if (award.statusCode !== 201) {
    throw new Error(`award creation failed: ${award.statusCode} ${JSON.stringify(award.body)}`);
  }
  const awardId = award.body.award.id;
  const verification = await request(app)
    .post(`/api/awards/${awardId}/verification`)
    .set("Authorization", `Bearer ${officerToken}`)
    .send({ outcome: "verified", notes: "Checked school records in person", evidence_ref: "EVIDENCE-001" });
  if (verification.statusCode !== 200) {
    throw new Error(`verification failed: ${verification.statusCode} ${JSON.stringify(verification.body)}`);
  }
  return awardId;
}

describe("Beneficiary workflow end to end", () => {
  jest.setTimeout(120000);

  let confirmedPair;
  let clearedPair;
  let payableAwardId;
  let disbursementId;

  beforeAll(async () => {
    officer = await createUser("field_officer", "WorkflowOfficer");
    admin = await createUser("admin", "WorkflowAdmin");

    const nationalIdA = `WF-DUP-${Date.now()}`;
    const first = await registerStudent({ full_name: "Workflow Duplicate One", national_id_number: nationalIdA });
    const second = await registerStudent({ full_name: "Workflow Duplicate One", national_id_number: nationalIdA });
    confirmedPair = {
      original: first.student,
      flagged: second.student,
      flag: second.duplicate_flags[0],
      screening: second.duplicate_screening,
    };

    const nationalIdB = `WF-SIB-${Date.now()}`;
    const third = await registerStudent({ full_name: "Workflow Sibling Three", national_id_number: nationalIdB });
    const fourth = await registerStudent({ full_name: "Workflow Sibling Three", national_id_number: nationalIdB });
    clearedPair = { original: third.student, flagged: fourth.student, flag: fourth.duplicate_flags[0] };

    if (!confirmedPair.flag || !clearedPair.flag) {
      throw new Error("setup did not create the duplicate flags the workflow needs");
    }
  });

  afterAll(async () => {
    const studentIds = created.students;
    if (studentIds.length) {
      const disbursements = await pool.query(
        "SELECT id FROM disbursements WHERE student_id = ANY($1::uuid[])",
        [studentIds]
      );
      const disbursementIds = disbursements.rows.map((row) => row.id);
      if (disbursementIds.length) {
        await pool.query(
          "DELETE FROM disbursement_reconciliation_events WHERE disbursement_id = ANY($1::uuid[])",
          [disbursementIds]
        ).catch(() => {});
        await pool.query("DELETE FROM disbursements WHERE id = ANY($1::uuid[])", [disbursementIds]);
      }
      const awards = await pool.query("SELECT id FROM bursary_awards WHERE student_id = ANY($1::uuid[])", [studentIds]);
      const awardIds = awards.rows.map((row) => row.id);
      if (awardIds.length) {
        await pool.query(
          "DELETE FROM bursary_award_verification_events WHERE award_id = ANY($1::uuid[])",
          [awardIds]
        );
        await pool.query("DELETE FROM bursary_awards WHERE id = ANY($1::uuid[])", [awardIds]);
      }
      await pool.query("DELETE FROM students WHERE id = ANY($1::uuid[])", [studentIds]);
    }
    if (created.users.length) {
      await pool.query("DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])", [created.users]);
      await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
    }
  });

  test("a re-registration raises one review case carrying identifier evidence", () => {
    expect(confirmedPair.flag.status).toBe("pending");
    expect(confirmedPair.flag.risk_level).toBe("review");
    expect(confirmedPair.flag.exact_identifier_matches.length).toBeGreaterThan(0);
    expect(confirmedPair.screening.candidates_considered).toBeGreaterThan(0);
  });

  test("an award cannot be approved before the beneficiary is verified", async () => {
    const award = await request(app)
      .post("/api/awards")
      .set(auth(officer))
      .send({ student_id: confirmedPair.flagged.id, requested_amount: 5000 });
    expect(award.statusCode).toBe(201);

    const early = await request(app)
      .patch(`/api/awards/${award.body.award.id}/decision`)
      .set(auth(admin))
      .send({ decision: "approved", approved_amount: 5000, reason: "Looks complete" });
    expect(early.statusCode).toBe(409);
    expect(early.body.message).toMatch(/verify the beneficiary/i);
  });

  test("a pending duplicate blocks award approval and disbursement", async () => {
    const awardId = await createVerifiedAward(confirmedPair.flagged.id, 5000, officer.token);

    const blockedApproval = await request(app)
      .patch(`/api/awards/${awardId}/decision`)
      .set(auth(admin))
      .send({ decision: "approved", approved_amount: 5000, reason: "Verified and complete" });
    expect(blockedApproval.statusCode).toBe(409);
    expect(blockedApproval.body.message).toMatch(/resolve duplicate review cases/i);

    const blockedDisbursement = await request(app)
      .post("/api/disbursements")
      .set(auth(officer))
      .send({ award_id: awardId, amount: 1000, payment_method: "Bank transfer" });
    expect(blockedDisbursement.statusCode).toBe(409);
    expect(blockedDisbursement.body.message).toMatch(/only verified, approved awards/i);
  });

  test("confirming a duplicate keeps the beneficiary unpayable", async () => {
    const decision = await request(app)
      .patch(`/api/duplicate-flags/${confirmedPair.flag.id}`)
      .set(auth(admin))
      .send({ decision: "confirmed_duplicate", reason: "Same national ID and guardian, confirmed with the school" });
    expect(decision.statusCode).toBe(200);
    expect(decision.body.flag.status).toBe("confirmed_duplicate");

    const awardId = await createVerifiedAward(confirmedPair.flagged.id, 4000, officer.token);
    const stillBlocked = await request(app)
      .patch(`/api/awards/${awardId}/decision`)
      .set(auth(admin))
      .send({ decision: "approved", approved_amount: 4000, reason: "Attempt after confirmation" });
    expect(stillBlocked.statusCode).toBe(409);
    expect(stillBlocked.body.message).toMatch(/resolve duplicate review cases/i);
  });

  test("a resolved case cannot be re-decided", async () => {
    const again = await request(app)
      .patch(`/api/duplicate-flags/${confirmedPair.flag.id}`)
      .set(auth(admin))
      .send({ decision: "not_duplicate", reason: "Trying to reverse a confirmed duplicate" });
    expect(again.statusCode).toBe(404);
  });


  test("needs_verification still blocks; clearing the case unblocks the award", async () => {
    const escalated = await request(app)
      .patch(`/api/duplicate-flags/${clearedPair.flag.id}`)
      .set(auth(admin))
      .send({ decision: "needs_verification", reason: "Guardian details differ, asked the school to confirm" });
    expect(escalated.statusCode).toBe(200);

    const awardId = await createVerifiedAward(clearedPair.flagged.id, 5000, officer.token);
    const blocked = await request(app)
      .patch(`/api/awards/${awardId}/decision`)
      .set(auth(admin))
      .send({ decision: "approved", approved_amount: 5000, reason: "Still under review" });
    expect(blocked.statusCode).toBe(409);

    const cleared = await request(app)
      .patch(`/api/duplicate-flags/${clearedPair.flag.id}`)
      .set(auth(admin))
      .send({ decision: "not_duplicate", reason: "Different birth certificates, confirmed with the school" });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.body.flag.status).toBe("not_duplicate");

    const approved = await request(app)
      .patch(`/api/awards/${awardId}/decision`)
      .set(auth(admin))
      .send({ decision: "approved", approved_amount: 5000, reason: "Verified, duplicate case cleared" });
    expect(approved.statusCode).toBe(200);
    const stored = await pool.query("SELECT status, approved_amount FROM bursary_awards WHERE id = $1", [awardId]);
    expect(stored.rows[0].status).toBe("approved");
    expect(Number(stored.rows[0].approved_amount)).toBe(5000);
    payableAwardId = awardId;
  });

  test("a payment cannot exceed the approved amount", async () => {
    const first = await request(app)
      .post("/api/disbursements")
      .set(auth(officer))
      .send({ award_id: payableAwardId, amount: 3000, payment_method: "Bank transfer", payment_reference: "BANK-REF-1" });
    expect(first.statusCode).toBe(201);
    expect(first.body.message).toMatch(/clearance is not confirmed/i);
    disbursementId = first.body.disbursement.id;

    const over = await request(app)
      .post("/api/disbursements")
      .set(auth(officer))
      .send({ award_id: payableAwardId, amount: 3000, payment_method: "Bank transfer" });
    expect(over.statusCode).toBe(409);
    expect(over.body.message).toMatch(/exceeds the remaining approved amount/i);
  });

  test("clearance needs evidence and is written to the reconciliation trail", async () => {
    const noEvidence = await request(app)
      .patch(`/api/disbursements/${disbursementId}/payment-status`)
      .set(auth(officer))
      .send({ payment_status: "cleared" });
    expect(noEvidence.statusCode).toBe(400);

    const cleared = await request(app)
      .patch(`/api/disbursements/${disbursementId}/payment-status`)
      .set(auth(officer))
      .send({ payment_status: "cleared", evidence_ref: "BANK-STATEMENT-2026-10" });
    if (cleared.statusCode !== 200) {
      throw new Error(`clearance failed: ${cleared.statusCode} ${JSON.stringify(cleared.body)}`);
    }

    const events = await pool.query(
      "SELECT event_type FROM disbursement_reconciliation_events WHERE disbursement_id = $1 ORDER BY created_at ASC, id ASC",
      [disbursementId]
    );
    const types = events.rows.map((row) => row.event_type);
    expect(types).toContain("payment_issued");
    expect(types).toContain("payment_cleared");
  });


  test("receipt acknowledgement is recorded, and a short payment is flagged as a discrepancy", async () => {
    const shortfall = await request(app)
      .patch(`/api/disbursements/${disbursementId}/acknowledgement`)
      .set(auth(officer))
      .send({ acknowledged_amount: 2500, evidence_ref: "ACK-SLIP-1" });
    expect(shortfall.statusCode).toBe(200);
    expect(shortfall.body.disbursement.receipt_status).toBe("discrepancy");

    const full = await request(app)
      .patch(`/api/disbursements/${disbursementId}/acknowledgement`)
      .set(auth(officer))
      .send({ acknowledged_amount: 3000, evidence_ref: "ACK-SLIP-2" });
    expect(full.statusCode).toBe(200);
    expect(full.body.disbursement.receipt_status).toBe("acknowledged");

    const events = await pool.query(
      "SELECT count(*)::int AS total FROM disbursement_reconciliation_events WHERE disbursement_id = $1 AND event_type = 'receipt_acknowledged'",
      [disbursementId]
    );
    expect(events.rows[0].total).toBe(2);

    // deadline_days is null when ACKNOWLEDGEMENT_OVERDUE_DAYS is unset: the API then
    // reports no overdue exceptions rather than inventing a deadline.
    const exceptions = await request(app).get("/api/disbursements/exceptions").set(auth(officer));
    expect(exceptions.statusCode).toBe(200);
    expect(exceptions.body).toHaveProperty("deadline_days");
    const deadline = exceptions.body.deadline_days;
    expect(deadline === null || (Number.isInteger(deadline) && deadline >= 1)).toBe(true);
    expect(Array.isArray(exceptions.body.exceptions)).toBe(true);
  });

  test("the audit trail records every step of the workflow", async () => {
    const actions = await pool.query(
      "SELECT action FROM audit_logs WHERE user_id = ANY($1::uuid[])",
      [created.users]
    );
    const seen = new Set(actions.rows.map((row) => row.action));
    for (const expected of [
      "CREATE",
      "AWARD_VERIFICATION_RECORDED",
      "DUPLICATE_CONFIRMED_DUPLICATE",
      "DUPLICATE_NOT_DUPLICATE",
      "AWARD_APPROVED",
      "PAYMENT_ISSUED",
      "PAYMENT_CLEARED",
      "RECEIPT_ACKNOWLEDGED_OFFICER_ASSISTED",
    ]) {
      expect(seen.has(expected)).toBe(true);
    }

    const viaApi = await request(app).get("/api/audit-logs").set(auth(admin));
    expect(viaApi.statusCode).toBe(200);
    const entries = Array.isArray(viaApi.body) ? viaApi.body : viaApi.body.value;
    expect(entries.some((entry) => entry.action === "PAYMENT_ISSUED")).toBe(true);
  });

  test("role boundaries hold across the workflow", async () => {
    const officerReview = await request(app)
      .patch(`/api/duplicate-flags/${clearedPair.flag.id}`)
      .set(auth(officer))
      .send({ decision: "not_duplicate", reason: "Field officer trying to adjudicate" });
    expect(officerReview.statusCode).toBe(403);

    const officerApprove = await request(app)
      .patch(`/api/awards/${payableAwardId}/decision`)
      .set(auth(officer))
      .send({ decision: "approved", approved_amount: 5000, reason: "Officer approving an award" });
    expect(officerApprove.statusCode).toBe(403);

    const adminRegister = await request(app)
      .post("/api/students")
      .set(auth(admin))
      .send({ full_name: "Admin Registered", school_code: "Nairobi School" });
    expect(adminRegister.statusCode).toBe(403);

    const adminAward = await request(app)
      .post("/api/awards")
      .set(auth(admin))
      .send({ student_id: clearedPair.flagged.id, requested_amount: 1000 });
    expect(adminAward.statusCode).toBe(403);
  });

  });
