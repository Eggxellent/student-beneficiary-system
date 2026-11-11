const QRCode = require('qrcode');
const { z } = require('zod');
const pool = require('../config/db');
const certificateModel = require('../models/bursaryCertificate.model');
const {
  buildCertificateVerificationUrl,
  buildCertificateVerificationPageUrl,
} = require('../config/publicAppUrl');
const { getCertificateIdentity } = require('../config/certificateIdentity');
const { normalizeCertificateReference } = require('../services/certificateReference');
const { issueForApprovedAward } = require('../services/certificateIssue');
const { renderCertificatePdf } = require('../services/certificateDocument');

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const AWARD_PERIOD_PATTERN = /^\d{4}(\/\d{4})?$/;


const issueSchema = z.object({
  award_period: z.string().trim().regex(AWARD_PERIOD_PATTERN, 'Use a year such as 2026 or a range such as 2025/2026').optional(),
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
    proposed_by_name: row.proposed_by_name || null,
    approved_by_name: row.approved_by_name || null,
    status: row.status,
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
function publicView(row) {
  const identity = getCertificateIdentity();

  if (!row) return { valid: false, status: 'not_recognised' };

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

    const created = await issueForApprovedAward(client, {
      award,
      student,
      actorId,
      awardPeriod: parsed.data.award_period,
    });
    if (!created) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'A certificate has already been issued for this award.' });
    }
    await client.query('COMMIT');

    const row = await certificateModel.findById(created.id);
    const verificationUrl = buildCertificateVerificationUrl(row.verification_token);
    const manualVerificationUrl = buildCertificateVerificationPageUrl();
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

// Field officers handle the paper certificate for the awards they proposed; an administrator may
// read any certificate. A certificate only exists for an approved award, so an award that is no
// longer approved must not hand out one, even if a row survives from before that rule.
function accessRefusal(req, row) {
  const actorId = req.user.id || req.user.sub;
  if (req.user.role === 'field_officer' && row.award_submitted_by !== actorId) {
    return { status: 403, message: 'You can only open certificates for awards you proposed.' };
  }
  if (row.award_status !== 'approved') {
    return { status: 409, message: 'This award is not approved, so its certificate is not available.' };
  }
  return null;
}

async function get(req, res, next) {
  try {
    const row = await certificateModel.findByAwardId(req.params.id);
    if (!row) return res.status(404).json({ message: 'No certificate has been issued for this award.' });
    const refusal = accessRefusal(req, row);
    if (refusal) return res.status(refusal.status).json({ message: refusal.message });
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
    const refusal = accessRefusal(req, row);
    if (refusal) return res.status(refusal.status).json({ message: refusal.message });
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

// Certificate revocation is deliberately not part of SBMS. One approved award produces one
// certificate; the only thing that can make it stop verifying is the award itself changing.
module.exports = { issue, get, downloadPdf, verifyPublic, publicView, staffView };
