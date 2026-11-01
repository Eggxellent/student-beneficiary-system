const pool = require('../config/db');

// The certificate row is a snapshot of the approved facts. `award_status` and the live
// `approved_amount` are read alongside it so the public verification endpoint can tell a genuine
// certificate from one whose underlying award has since changed.
const WITH_LIVE_AWARD = `
  SELECT c.*, a.status AS award_status, a.approved_amount AS award_live_amount,
         a.decided_at AS award_decided_at, issuer.full_name AS issued_by_name
  FROM bursary_certificates c
  JOIN bursary_awards a ON a.id = c.award_id
  JOIN users issuer ON issuer.id = c.issued_by
`;

async function findByAwardId(awardId, executor = pool) {
  const { rows } = await executor.query(`${WITH_LIVE_AWARD} WHERE c.award_id = $1`, [awardId]);
  return rows[0] || null;
}

async function findById(id, executor = pool) {
  const { rows } = await executor.query(`${WITH_LIVE_AWARD} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}

async function findByVerificationToken(token, executor = pool) {
  const { rows } = await executor.query(`${WITH_LIVE_AWARD} WHERE c.verification_token = $1`, [token]);
  return rows[0] || null;
}

async function insert({
  award_id, certificate_reference, verification_token, award_period, student_name, student_upi,
  school_code, approved_amount, award_approved_at, issued_by,
}, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO bursary_certificates
       (award_id, certificate_reference, verification_token, award_period, student_name, student_upi,
        school_code, approved_amount, award_approved_at, issued_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (award_id) DO NOTHING
     RETURNING *`,
    [award_id, certificate_reference, verification_token, award_period, student_name, student_upi || null,
      school_code, approved_amount, award_approved_at, issued_by]
  );
  return rows[0] || null;
}

async function revoke(id, { actorId, reason }, executor = pool) {
  const { rows } = await executor.query(
    `UPDATE bursary_certificates
     SET status = 'revoked', revoked_by = $2, revoked_at = NOW(), revocation_reason = $3
     WHERE id = $1 AND status = 'active'
     RETURNING *`,
    [id, actorId, reason]
  );
  return rows[0] || null;
}

module.exports = { findByAwardId, findById, findByVerificationToken, insert, revoke };
