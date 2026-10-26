const pool = require('../config/db');

async function create({
  student_id,
  award_id,
  amount,
  disbursement_date,
  created_by,
  payment_method,
  payment_reference,
}, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO disbursements
       (student_id, award_id, amount, disbursement_date, created_by, payment_method,
        payment_reference, payment_status, status, receipt_status)
     VALUES ($1, $2, $3, COALESCE($4, CURRENT_DATE), $5, $6, $7, 'issued', 'issued', 'awaiting_acknowledgement')
     RETURNING *`,
    [student_id, award_id, amount, disbursement_date || null, created_by, payment_method, payment_reference || null]
  );
  return rows[0];
}

async function getAll() {
  const { rows } = await pool.query(
    `SELECT d.*, s.full_name AS student_name, s.is_synthetic AS student_is_synthetic,
            a.school_code AS award_school_code, a.status AS award_status,
            a.approved_amount AS award_approved_amount,
            a.verification_status AS award_verification_status,
            a.id AS award_reference,
            COALESCE(p.total_disbursed, 0)::numeric AS award_paid_total,
            COALESCE(history.events, '[]'::jsonb) AS reconciliation_history
     FROM disbursements d
     JOIN students s ON d.student_id = s.id
     LEFT JOIN bursary_awards a ON a.id = d.award_id
     LEFT JOIN LATERAL (
       SELECT SUM(amount) AS total_disbursed FROM disbursements
       WHERE award_id = d.award_id AND (payment_status IS NULL OR payment_status NOT IN ('failed', 'cancelled'))
     ) p ON TRUE
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(jsonb_build_object(
         'event_type', e.event_type, 'payment_status', e.payment_status,
         'receipt_status', e.receipt_status, 'amount', e.amount,
         'evidence_ref', e.evidence_ref, 'notes', e.notes,
         'actor_name', u.full_name, 'created_at', e.created_at
       ) ORDER BY e.created_at DESC) AS events
       FROM disbursement_reconciliation_events e JOIN users u ON u.id = e.actor_id
       WHERE e.disbursement_id = d.id
     ) history ON TRUE
     ORDER BY d.created_at DESC`
  );
  return rows;
}

module.exports = { create, getAll };
