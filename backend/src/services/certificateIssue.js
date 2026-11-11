const { randomBytes } = require('crypto');
const logAudit = require('./auditLog');
const certificateModel = require('../models/bursaryCertificate.model');
const { generateCertificateReference } = require('./certificateReference');
const { notifyCertificateReady } = require('./notifications');
const {
  buildCertificateVerificationUrl,
  buildCertificateVerificationPageUrl,
} = require('../config/publicAppUrl');

// A reference is only written into the table by this service; this is the retry budget when the
// database's UNIQUE constraint rejects a freshly generated one.
const REFERENCE_ATTEMPTS = 5;

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

// Issues the single certificate an approved award may hold, inside the caller's transaction.
//
// One function serves both paths that can produce a certificate: the automatic issuance that runs
// in the same transaction as the approval (`bursaryAwards.decide`), and the administrator's retry
// endpoint for awards approved before automatic generation existed. Returns null when a certificate
// already exists for the award, so callers can treat the operation as idempotent.
async function issueForApprovedAward(client, { award, student, actorId, awardPeriod }) {
  const approvedAt = award.decided_at || new Date();
  const year = new Date(approvedAt).getUTCFullYear();
  const period = awardPeriod || String(year);
  const token = randomBytes(32).toString('hex');

  // Both URLs are resolved before the row is written, so a bad PUBLIC_APP_URL fails without
  // leaving a certificate that no QR code can reach.
  buildCertificateVerificationUrl(token);
  buildCertificateVerificationPageUrl();

  const created = await insertWithUniqueReference(client, {
    award_id: award.id,
    verification_token: token,
    award_period: period,
    student_name: student.full_name,
    student_upi: student.upi,
    school_code: student.school_code || award.school_code,
    approved_amount: award.approved_amount,
    award_approved_at: approvedAt,
    issued_by: actorId,
  }, year);

  if (created) {
    await logAudit(actorId, 'AWARD_CERTIFICATE_ISSUED', 'bursary_certificates', created.id, {
      award_id: award.id,
      certificate_reference: created.certificate_reference,
      award_period: period,
    }, client);
    // Issuance is the event the proposing officer was waiting for: the certificate is only useful
    // once they know it exists. Placed here rather than in the approval controller so the
    // administrator's retry path notifies the same way, and deduped on the certificate id so a
    // retry cannot produce a second "ready" notification.
    await notifyCertificateReady(client, {
      award,
      studentName: student.full_name,
      certificate: created,
    });
  }

  return created;
}

module.exports = { issueForApprovedAward };
