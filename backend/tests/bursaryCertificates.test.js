const request = require("supertest");
const bcrypt = require("bcrypt");
const app = require("../src/index");
const pool = require("../src/config/db");
const certificateRateLimit = require("../src/middleware/certificateRateLimit");

// End-to-end coverage of the certificate lifecycle against the guarded local sbms_test database:
// approval is a precondition, the QR payload is a verification URL, the public endpoint answers
// with authenticity only, and revocation supersedes a printed copy.
const created = { users: [], students: [], awards: [] };

async function createUser(role, label) {
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
  return { id: rows[0].id, token: login.body.token, email, full_name: label };
}

const auth = (actor) => ({ Authorization: `Bearer ${actor.token}` });

let officer;
let admin;
let student;
let approvedAward;
let approvedAwardWithChangedAmount;
let pendingAward;
let rejectedAward;
let certificate;
let secondCertificate;

async function registerStudent(label) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const response = await request(app)
    .post("/api/students")
    .set(auth(officer))
    .send({
      full_name: `${label} Learner`,
      date_of_birth: "2009-05-04",
      school_code: "Nairobi School",
      primary_phone: "+254700555111",
      upi: `CERT-UPI-${stamp}`,
      birth_certificate_number: `CERT-BC-${stamp}`,
    });
  if (response.statusCode !== 201) {
    throw new Error(`registration failed: ${response.statusCode} ${JSON.stringify(response.body)}`);
  }
  created.students.push(response.body.student.id);
  return response.body.student;
}

async function submitAward(studentId, amount) {
  const response = await request(app)
    .post("/api/awards")
    .set(auth(officer))
    .send({ student_id: studentId, requested_amount: amount });
  if (response.statusCode !== 201) {
    throw new Error(`award creation failed: ${response.statusCode} ${JSON.stringify(response.body)}`);
  }
  created.awards.push(response.body.award.id);
  return response.body.award.id;
}

async function verifyAward(awardId) {
  const response = await request(app)
    .post(`/api/awards/${awardId}/verification`)
    .set(auth(officer))
    .send({ outcome: "verified", notes: "School register checked in person", evidence_ref: "CERT-EVIDENCE-1" });
  if (response.statusCode !== 200) {
    throw new Error(`verification failed: ${response.statusCode} ${JSON.stringify(response.body)}`);
  }
}

async function decideAward(awardId, decision, approvedAmount) {
  const payload = { decision, reason: decision === "approved" ? "Eligible after verification" : "Records did not match" };
  if (approvedAmount) payload.approved_amount = approvedAmount;
  const response = await request(app).patch(`/api/awards/${awardId}/decision`).set(auth(admin)).send(payload);
  if (response.statusCode !== 200) {
    throw new Error(`decision failed: ${response.statusCode} ${JSON.stringify(response.body)}`);
  }
}

async function tokenFromVerificationUrl(url) {
  return new URLSearchParams(new URL(url).hash.slice(1)).get("token");
}

describe("Bursary award certificates", () => {
  jest.setTimeout(120000);

  beforeAll(async () => {
    officer = await createUser("field_officer", "CertificateOfficer");
    admin = await createUser("admin", "CertificateAdmin");
    student = await registerStudent("Certificate Probe");

    approvedAward = await submitAward(student.id, 50000);
    await verifyAward(approvedAward);
    await decideAward(approvedAward, "approved", 45000);

    approvedAwardWithChangedAmount = await submitAward(student.id, 40000);
    await verifyAward(approvedAwardWithChangedAmount);
    await decideAward(approvedAwardWithChangedAmount, "approved", 35000);

    pendingAward = await submitAward(student.id, 20000);

    rejectedAward = await submitAward(student.id, 15000);
    await decideAward(rejectedAward, "rejected");
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM bursary_certificates WHERE award_id = ANY($1::uuid[])",
      [created.awards]
    );
    await pool.query(
      "DELETE FROM bursary_award_verification_events WHERE award_id = ANY($1::uuid[])",
      [created.awards]
    );
    await pool.query("DELETE FROM duplicate_flags WHERE student_id = ANY($1::uuid[])", [created.students]);
    await pool.query("DELETE FROM bursary_awards WHERE id = ANY($1::uuid[])", [created.awards]);
    await pool.query("DELETE FROM students WHERE id = ANY($1::uuid[])", [created.students]);
    await pool.query("DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])", [created.users]);
    await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [created.users]);
    await pool.end();
  });

  beforeEach(() => {
    certificateRateLimit.reset();
  });

  test("an award that is not approved cannot be certified", async () => {
    const pending = await request(app)
      .post(`/api/awards/${pendingAward}/certificate`)
      .set(auth(admin))
      .send({});
    expect(pending.statusCode).toBe(409);
    expect(pending.body.message).toMatch(/approved award/i);

    const rejected = await request(app)
      .post(`/api/awards/${rejectedAward}/certificate`)
      .set(auth(admin))
      .send({});
    expect(rejected.statusCode).toBe(409);

    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM bursary_certificates WHERE award_id = ANY($1::uuid[])",
      [[pendingAward, rejectedAward]]
    );
    expect(rows[0].total).toBe(0);
  });

  test("only an administrator may issue or revoke a certificate", async () => {
    const issued = await request(app)
      .post(`/api/awards/${approvedAward}/certificate`)
      .set(auth(officer))
      .send({});
    expect(issued.statusCode).toBe(403);

    const anonymous = await request(app).post(`/api/awards/${approvedAward}/certificate`).send({});
    expect(anonymous.statusCode).toBe(401);
  });

  test("a malformed award period is refused before a certificate is written", async () => {
    const response = await request(app)
      .post(`/api/awards/${approvedAward}/certificate`)
      .set(auth(admin))
      .send({ award_period: "20XX" });
    expect(response.statusCode).toBe(400);
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS total FROM bursary_certificates WHERE award_id = $1",
      [approvedAward]
    );
    expect(rows[0].total).toBe(0);
  });

  test("an approved award produces a certificate whose QR payload is a verification URL", async () => {
    const response = await request(app)
      .post(`/api/awards/${approvedAward}/certificate`)
      .set(auth(admin))
      .send({ award_period: "2025/2026" });
    expect(response.statusCode).toBe(201);

    certificate = response.body.certificate;
    expect(certificate.certificate_reference).toMatch(
      /^SBMS-\d{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{3}$/
    );
    expect(certificate.award_period).toBe("2025/2026");
    expect(certificate.approved_amount).toBe(45000);
    expect(certificate.student_name).toBe(student.full_name);
    expect(certificate.school_code).toBe("Nairobi School");
    expect(certificate.issued_by_name).toBe("CertificateAdmin");
    expect(certificate.status).toBe("active");
    expect(certificate.verification_page_url).toBe("https://sbms-test-fixture.ac.ke/verify-certificate");

    expect(response.body.verification_url).toMatch(
      /^https:\/\/sbms-test-fixture\.ac\.ke\/verify-certificate#token=[a-f0-9]{64}$/
    );
    expect(response.body.qr_code.startsWith("data:image/png;base64,")).toBe(true);

    const token = await tokenFromVerificationUrl(response.body.verification_url);
    const stored = await pool.query(
      "SELECT verification_token, approved_amount FROM bursary_certificates WHERE award_id = $1",
      [approvedAward]
    );
    expect(stored.rows[0].verification_token).toBe(token);
    expect(Number(stored.rows[0].approved_amount)).toBe(45000);

    // The QR payload carries the opaque token and the printed reference carries neither the token
    // nor any database identifier.
    expect(response.body.verification_url).not.toContain(certificate.certificate_reference);
    expect(certificate.certificate_reference).not.toContain(token);
  });

  test("a second certificate cannot be issued for the same award", async () => {
    const response = await request(app)
      .post(`/api/awards/${approvedAward}/certificate`)
      .set(auth(admin))
      .send({});
    expect(response.statusCode).toBe(409);
    expect(response.body.certificate_reference).toBe(certificate.certificate_reference);
  });

  test("staff can read the certificate and download a printable PDF", async () => {
    const read = await request(app).get(`/api/awards/${approvedAward}/certificate`).set(auth(officer));
    expect(read.statusCode).toBe(200);
    expect(read.body.certificate.certificate_reference).toBe(certificate.certificate_reference);
    expect(read.body.qr_code.startsWith("data:image/png;base64,")).toBe(true);

    const pdf = await request(app).get(`/api/awards/${approvedAward}/certificate.pdf`).set(auth(officer));
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(`${certificate.certificate_reference}.pdf`);
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    expect(pdf.body.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.body.length).toBeGreaterThan(5000);

    // One A4 landscape page: the printed certificate must not spill onto a second sheet.
    const raw = pdf.body.toString("latin1");
    expect((raw.match(/\/Type \/Page[^s]/g) || [])).toHaveLength(1);
    expect(raw).toContain("MediaBox [0 0 841.89 595.28]");
    expect(raw).not.toMatch(/\/URI/);

    // A reprint of the same certificate is the same document, byte for byte.
    const reprint = await request(app)
      .get(`/api/awards/${approvedAward}/certificate.pdf`)
      .set(auth(officer));
    expect(reprint.statusCode).toBe(200);
    expect(reprint.body.equals(pdf.body)).toBe(true);

    const missing = await request(app).get(`/api/awards/${pendingAward}/certificate`).set(auth(admin));
    expect(missing.statusCode).toBe(404);
    const missingPdf = await request(app).get(`/api/awards/${pendingAward}/certificate.pdf`).set(auth(admin));
    expect(missingPdf.statusCode).toBe(404);
  });

  test("the public endpoint shows the certificate facts a printed copy can be compared with", async () => {
    const token = await tokenFromVerificationUrl(certificate.verification_url);
    const response = await request(app).post("/api/certificates/verify").send({ token });

    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual([
      "approved_amount",
      "award_approved_at",
      "award_period",
      "award_status",
      "beneficiary_name",
      "certificate_reference",
      "constituency",
      "institution",
      "issued_at",
      "issuing_authority",
      "programme",
      "status",
      "valid",
    ]);
    expect(response.body.valid).toBe(true);
    expect(response.body.status).toBe("verified");
    expect(response.body.certificate_reference).toBe(certificate.certificate_reference);
    expect(response.body.beneficiary_name).toBe(student.full_name);
    expect(response.body.institution).toBe("Nairobi School");
    expect(response.body.programme).toBe("NG-CDF bursary programme");
    expect(response.body.constituency).toBeNull();
    expect(response.body.approved_amount).toBe(45000);
    expect(response.body.award_period).toBe("2025/2026");
    expect(response.body.issuing_authority).toBe("Student Beneficiary Management System (SBMS)");
    expect(Number.isNaN(Date.parse(response.body.issued_at))).toBe(false);
    expect(Number.isNaN(Date.parse(response.body.award_approved_at))).toBe(false);

    // The disclosure is limited to what the paper document shows. The whole body is checked, so a
    // future edit that adds an identifier, a contact, a document reference, a duplicate score or
    // the verification token itself fails here.
    const serialized = JSON.stringify(response.body);
    for (const forbidden of [
      student.upi,
      student.national_id_number || "NATIONAL-ID-NOT-SET",
      student.birth_certificate_number || "BIRTH-CERT-NOT-SET",
      "primary_phone",
      "date_of_birth",
      "guardian",
      "award_id",
      "verification_token",
      "duplicate",
      token,
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  test("the printed reference verifies the same certificate as the QR code", async () => {
    const token = await tokenFromVerificationUrl(certificate.verification_url);
    const byToken = await request(app).post("/api/certificates/verify").send({ token });
    const reference = certificate.certificate_reference;

    for (const typed of [reference, reference.toLowerCase(), `  ${reference}  `, reference.replace(/-/g, " ")]) {
      const byReference = await request(app).post("/api/certificates/verify").send({ reference: typed });
      expect(byReference.statusCode).toBe(200);
      expect(byReference.body).toEqual(byToken.body);
    }

    // The code part alone is enough: people copy only that part of the printed reference.
    const bodyOnly = await request(app)
      .post("/api/certificates/verify")
      .send({ reference: reference.replace(/^SBMS-/, "") });
    expect(bodyOnly.body.certificate_reference).toBe(reference);
  });

  test("a reference that matches nothing is refused without revealing anything", async () => {
    const bodies = [
      { reference: "SBMS-2026-2222-2222-222" },
      { reference: "SBMS-CERT-2026-00000000" },
      { reference: "SBMS-2026-IIII-IIII-III" },
      { reference: "not a reference" },
      { reference: 12345 },
      { reference: null },
      { reference: certificate.certificate_reference, token: "a".repeat(64) },
      { certificate_reference: certificate.certificate_reference },
    ];

    for (const body of bodies) {
      const response = await request(app).post("/api/certificates/verify").send(body);
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ valid: false, status: "not_recognised" });
    }
  });

  test("unknown, malformed and manipulated tokens are refused identically", async () => {
    const token = await tokenFromVerificationUrl(certificate.verification_url);
    const flipped = `${token.slice(0, 63)}${token.endsWith("a") ? "b" : "a"}`;

    const bodies = [
      { token: flipped },
      { token: "f".repeat(64) },
      { token: token.toUpperCase() },
      { token: token.slice(0, 63) },
      { token: `${token}0` },
      { token: 12345 },
      { token: null },
      { token, certificate_reference: certificate.certificate_reference },
      {},
    ];

    for (const body of bodies) {
      const response = await request(app).post("/api/certificates/verify").send(body);
      expect(response.statusCode).toBe(200);
      expect(response.body).toEqual({ valid: false, status: "not_recognised" });
      expect(JSON.stringify(response.body)).not.toContain(token);
    }
  });

  test("a certificate token is not a student-record token, and the reverse holds", async () => {
    const token = await tokenFromVerificationUrl(certificate.verification_url);

    const studentEndpoint = await request(app).post("/api/verify").send({ token });
    expect(studentEndpoint.statusCode).toBe(200);
    expect(studentEndpoint.body).toEqual({ found: false });

    // A student QR token is not published by any endpoint, so a random 64-hex value stands in for
    // one: the certificate endpoint must not accept it either way.
    const certificateEndpoint = await request(app)
      .post("/api/certificates/verify")
      .send({ token: "c".repeat(64) });
    expect(certificateEndpoint.body).toEqual({ valid: false, status: "not_recognised" });
  });

  test("a certificate stops verifying when the approved amount changes after issue", async () => {
    const issued = await request(app)
      .post(`/api/awards/${approvedAwardWithChangedAmount}/certificate`)
      .set(auth(admin))
      .send({});
    expect(issued.statusCode).toBe(201);
    secondCertificate = issued.body.certificate;
    const token = await tokenFromVerificationUrl(issued.body.verification_url);

    // Every certificate gets its own reference: two awards never share one, and the code part is
    // not a sequence number.
    expect(secondCertificate.certificate_reference).not.toBe(certificate.certificate_reference);
    expect(secondCertificate.certificate_reference.slice(10)).not.toBe(
      certificate.certificate_reference.slice(10)
    );

    const before = await request(app).post("/api/certificates/verify").send({ token });
    expect(before.body.status).toBe("verified");

    await pool.query("UPDATE bursary_awards SET approved_amount = 35500 WHERE id = $1", [
      approvedAwardWithChangedAmount,
    ]);

    const after = await request(app).post("/api/certificates/verify").send({ token });
    expect(after.statusCode).toBe(200);
    expect(after.body.valid).toBe(false);
    expect(after.body.status).toBe("not_current");
    expect(after.body.certificate_reference).toBe(secondCertificate.certificate_reference);
    expect(after.body.award_period).toBeUndefined();
  });

  test("a revoked certificate is reported as revoked and the award itself is untouched", async () => {
    const officerAttempt = await request(app)
      .post(`/api/awards/${approvedAward}/certificate/revoke`)
      .set(auth(officer))
      .send({ reason: "Officer trying to revoke" });
    expect(officerAttempt.statusCode).toBe(403);

    const tooShort = await request(app)
      .post(`/api/awards/${approvedAward}/certificate/revoke`)
      .set(auth(admin))
      .send({ reason: "no" });
    expect(tooShort.statusCode).toBe(400);

    const unknownAward = await request(app)
      .post(`/api/awards/${pendingAward}/certificate/revoke`)
      .set(auth(admin))
      .send({ reason: "No certificate exists here" });
    expect(unknownAward.statusCode).toBe(404);

    const revoked = await request(app)
      .post(`/api/awards/${approvedAward}/certificate/revoke`)
      .set(auth(admin))
      .send({ reason: "Award withdrawn after a records correction" });
    expect(revoked.statusCode).toBe(200);

    const twice = await request(app)
      .post(`/api/awards/${approvedAward}/certificate/revoke`)
      .set(auth(admin))
      .send({ reason: "Trying again after revocation" });
    expect(twice.statusCode).toBe(409);

    const token = await tokenFromVerificationUrl(certificate.verification_url);
    const verification = await request(app).post("/api/certificates/verify").send({ token });
    expect(verification.statusCode).toBe(200);
    expect(verification.body).toEqual({
      valid: false,
      status: "revoked",
      certificate_reference: certificate.certificate_reference,
      award_period: "2025/2026",
      revoked_at: expect.any(String),
      issuing_authority: "Student Beneficiary Management System (SBMS)",
    });

    const award = await pool.query("SELECT status, approved_amount FROM bursary_awards WHERE id = $1", [approvedAward]);
    expect(award.rows[0].status).toBe("approved");
    expect(Number(award.rows[0].approved_amount)).toBe(45000);

    const read = await request(app).get(`/api/awards/${approvedAward}/certificate`).set(auth(admin));
    expect(read.body.certificate.status).toBe("revoked");
    expect(read.body.certificate.revocation_reason).toBe("Award withdrawn after a records correction");
  });

  test("issuing and revoking are recorded in the audit trail", async () => {
    const { rows } = await pool.query(
      "SELECT action, table_name, record_id FROM audit_logs WHERE user_id = $1",
      [admin.id]
    );
    const actions = rows.map((row) => row.action);
    expect(actions).toContain("AWARD_CERTIFICATE_ISSUED");
    expect(actions).toContain("AWARD_CERTIFICATE_REVOKED");
    const certificateEntries = rows.filter((row) => row.action.startsWith("AWARD_CERTIFICATE"));
    expect(certificateEntries.every((row) => row.table_name === "bursary_certificates")).toBe(true);
    expect(certificateEntries.every((row) => Boolean(row.record_id))).toBe(true);
  });
});
