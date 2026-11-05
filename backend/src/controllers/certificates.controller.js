const { randomBytes } = require('crypto');
const QRCode = require('qrcode');
const { z } = require('zod');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const certificateModel = require('../models/bursaryCertificate.model');
const {
  buildCertificateVerificationUrl,
  buildCertificateVerificationPageUrl,
} = require('../config/publicAppUrl');
const { getCertificateIdentity } = require('../config/certificateIdentity');
const {
  generateCertificateReference,
  normalizeCertificateReference,
} = require('../services/certificateReference');
const { renderCertificatePdf } = require('../services/certificateDocument');

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const AWARD_PERIOD_PATTERN = /^\d{4}(\/\d{4})?$/;
// A reference is only written into the table by `issue()`; this is the retry budget when the
// database's UNIQUE constraint rejects a freshly generated one.
const REFERENCE_ATTEMPTS = 5;


const issueSchema = z.object({
  award_period: z.string().trim().regex(AWARD_PERIOD_PATTERN, 'Use a year such as 2026 or a range such as 2025/2026').optional(),
}).strict();

const revokeSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
}).strict();

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

// Staff-facing shape: enough to print and reconcile the certificate, including the identifiers that
// appear on the paper document.
function staffView(row, verificationUrl, manualVerificationUrl) {
  return {
    id: row.id,
    award_id: row.award_id,
    certificate_reference: row.certificate_reference,
    award_period: row.award_period,
    student_name: row.student_name,
    student_upi: row.student_upi,
    school_code: row.school_code,
    approved_amount: Number(row.approved_amount),
    award_approved_at: toIso(row.award_approved_at),
    issued_at: toIso(row.issued_at),
    issued_by_name: row.issued_by_name,
    status: row.status,
    revoked_at: row.revoked_at ? toIso(row.revoked_at) : null,
    revocation_reason: row.revocation_reason || null,
    verification_url: verificationUrl,
    verification_page_url: manualVerificationUrl,
  };
}

// Public shape. It exists so a stranger can compare a paper document against the authority of the
// database, which means it must show what the paper shows: the name, the institution, the academic
// year, the approved amount and the issue date. That is a deliberate disclosure decision, recorded
// in `docs/bursary-certificates-2026-11-01.md`; the holder of a certificate is handing it to a
// school or an employer precisely so they can read those facts.
//
// What it never shows: UPI or any other identifier, date of birth, national ID, birth certificate
// number, guardian or phone details, address, supporting-document references, duplicate-detection
// scores or flags, administrative notes, database identifiers, or the verification token itself.
// A revoked certificate answers with the minimum needed to identify it, because the disclosure
// decision above was made for a document that is current.
function publicView(row) {
  const identity = getCertificateIdentity();

  if (!row) return { valid: false, status: 'not_recognised' };

  if (row.status === 'revoked') {
    return {
      valid: false,
      status: 'revoked',
      certificate_reference: row.certificate_reference,
      award_period: row.award_period,
      revoked_at: row.revoked_at ? toIso(row.revoked_at) : null,
      issuing_authority: identity.issuingAuthority,
    };
  }

  // The certificate is a snapshot. If the award is no longer approved, or its approved amount was
  // changed after issue, the printed document no longer describes the record and must not verify.
  const amountUnchanged = Number(row.award_live_amount) === Number(row.approved_amount);
  if (row.award_status !== 'approved' || !amountUnchanged) {
    return {
      valid: false,
      status: 'not_current',
      certificate_reference: row.certificate_reference,
      issuing_authority: identity.issuingAuthority,
    };
  }

  return {
    valid: true,
    status: 'verified',
    certificate_reference: row.certificate_reference,
    beneficiary_name: row.student_name,
    institution: row.school_code,
    programme: identity.programme,
    constituency: identity.constituency,
    award_period: row.award_period,
    approved_amount: Number(row.approved_amount),
    issued_at: toIso(row.issued_at),
    award_approved_at: toIso(row.award_approved_at),
    award_status: 'approved',
    issuing_authority: identity.issuingAuthority,
  };
}

// The database owns uniqueness. A reference collision is astronomically unlikely at 55 bits, but it
// is still possible, and it must not surface as a 500. Each attempt runs inside its own savepoint
// because a failed INSERT aborts the surrounding transaction.
async function insertWithUniqueReference(client, data, year) {
  for (let attempt = 1; attempt <= REFERENCE_ATTEMPTS; attempt += 1) {
    const certificateReference = generateCertificateReference({ year });
    await client.query('SAVEPOINT certificate_insert');
    try {
      const created = await certificateModel.insert({ ...data, certificate_reference: certificateReference }, client);
      await client.query('RELEASE SAVEPOINT certificate_insert');
      return created;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT certificate_insert');
      const detail = `${error.constraint || ''} ${error.detail || ''}`;
      const referenceClash = error.code === '23505' && detail.includes('certificate_reference');
      if (!referenceClash) throw error;
    }
  }

  throw new Error('Unable to allocate a unique certificate reference');
}


async function qrDataUrl(verificationUrl) {
  return QRCode.toDataURL(verificationUrl, { margin: 1, width: 320 });
}

async function issue(req, res, next) {
  const parsed = issueSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: 'Enter the award period as a year (2026) or a range (2025/2026).' });
  }

  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: awards } = await client.query(
      'SELECT * FROM bursary_awards WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const award = awards[0];
    if (!award) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (award.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'A certificate can only be issued for an approved award.' });
    }
    const existing = await certificateModel.findByAwardId(award.id, client);
    if (existing) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: `A certificate has already been issued for this award (${existing.certificate_reference}).`,
        certificate_reference: existing.certificate_reference,
      });
    }
    const { rows: students } = await client.query(
      'SELECT full_name, upi, school_code FROM students WHERE id = $1',
      [award.student_id]
    );
    const student = students[0];
    if (!student) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'The student record for this award is missing.' });
    }

    const approvedAt = award.decided_at || new Date();
    const year = new Date(approvedAt).getUTCFullYear();
    const awardPeriod = parsed.data.award_period || String(year);
    const token = randomBytes(32).toString('hex');
    // Both URLs are resolved before the row is written, so a bad PUBLIC_APP_URL fails without
    // leaving a certificate that no QR code can reach.
    const verificationUrl = buildCertificateVerificationUrl(token);
    const manualVerificationUrl = buildCertificateVerificationPageUrl();

    const created = await insertWithUniqueReference(client, {
      award_id: award.id,
      verification_token: token,
      award_period: awardPeriod,
      student_name: student.full_name,
      student_upi: student.upi,
      school_code: student.school_code || award.school_code,
      approved_amount: award.approved_amount,
      award_approved_at: approvedAt,
      issued_by: actorId,
    }, year);
    if (!created) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'A certificate has already been issued for this award.' });
    }
    await logAudit(actorId, 'AWARD_CERTIFICATE_ISSUED', 'bursary_certificates', created.id, {
      award_id: award.id,
      certificate_reference: created.certificate_reference,
      award_period: awardPeriod,
    }, client);
    await client.query('COMMIT');

    const row = await certificateModel.findById(created.id);
    return res.status(201).json({
      message: 'Certificate issued.',
      certificate: staffView(row, verificationUrl, manualVerificationUrl),
      qr_code: await qrDataUrl(verificationUrl),
      verification_url: verificationUrl,
      verification_page_url: manualVerificationUrl,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

async function get(req, res, next) {
  try {
    const row = await certificateModel.findByAwardId(req.params.id);
    if (!row) return res.status(404).json({ message: 'No certificate has been issued for this award.' });
    const verificationUrl = buildCertificateVerificationUrl(row.verification_token);
    const manualVerificationUrl = buildCertificateVerificationPageUrl();
    return res.json({
      certificate: staffView(row, verificationUrl, manualVerificationUrl),
      qr_code: await qrDataUrl(verificationUrl),
      verification_url: verificationUrl,
      verification_page_url: manualVerificationUrl,
    });
  } catch (error) {
    return next(error);
  }
}

async function downloadPdf(req, res, next) {
  try {
    const row = await certificateModel.findByAwardId(req.params.id);
    if (!row) return res.status(404).json({ message: 'No certificate has been issued for this award.' });
    const verificationUrl = buildCertificateVerificationUrl(row.verification_token);
    const pdf = await renderCertificatePdf({
      certificate: row,
      // The QR carries the opaque token. The paper prints the base page and the reference, so a
      // reader who cannot scan types a reference instead of copying a token out of print.
      verificationUrl,
      manualVerificationUrl: buildCertificateVerificationPageUrl(),
      identity: getCertificateIdentity(),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${row.certificate_reference}.pdf"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
}

async function revoke(req, res, next) {
  const parsed = revokeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ message: 'Enter a reason of at least 5 characters for revoking the certificate.' });
  }

  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const existing = await certificateModel.findByAwardId(req.params.id, client);
    if (!existing) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'No certificate has been issued for this award.' });
    }
    const revoked = await certificateModel.revoke(existing.id, { actorId, reason: parsed.data.reason }, client);
    if (!revoked) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This certificate has already been revoked.' });
    }
    await logAudit(actorId, 'AWARD_CERTIFICATE_REVOKED', 'bursary_certificates', existing.id, {
      award_id: existing.award_id,
      certificate_reference: existing.certificate_reference,
      reason: parsed.data.reason,
    }, client);
    await client.query('COMMIT');
    return res.json({ message: 'Certificate revoked.', certificate_reference: existing.certificate_reference });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

// Public endpoint. It is deliberately shaped like the student-record endpoint: exactly one key,
// a fixed token shape, and the same answer for a malformed and an unknown value so the endpoint
// cannot be used to tell "this value exists but was refused" from "this value was never issued".
//
// Two things resolve to the same certificate row: the opaque QR token, and the reference printed on
// the certificate for someone who cannot scan. Both are answered from the database, both share this
// route's rate-limit budget, and neither is logged.
const NOT_RECOGNISED = { valid: false, status: 'not_recognised' };

async function verifyPublic(req, res) {
  const body = req.body;
  const keys = body && typeof body === 'object' && !Array.isArray(body) ? Object.keys(body) : [];
  if (keys.length !== 1) return res.json(NOT_RECOGNISED);

  const [key] = keys;
  let row;

  try {
    if (key === 'token') {
      if (typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) {
        return res.json(NOT_RECOGNISED);
      }
      row = await certificateModel.findByVerificationToken(body.token);
    } else if (key === 'reference') {
      const reference = normalizeCertificateReference(body.reference);
      if (!reference) return res.json(NOT_RECOGNISED);
      row = await certificateModel.findByReference(reference);
    } else {
      return res.json(NOT_RECOGNISED);
    }

    return res.json(publicView(row));
  } catch {
    // Never log or return the submitted value or database error details.
    return res.status(503).json({ error: 'temporarily_unavailable' });
  }
}

module.exports = { issue, get, downloadPdf, revoke, verifyPublic, publicView, staffView };
