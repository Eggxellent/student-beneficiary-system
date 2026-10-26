const { z } = require('zod');
const pool = require('../config/db');
const Disbursement = require('../models/disbursement.model');
const logAudit = require('../services/auditLog');
const { acknowledgementOverdueDays } = require('../config/reconciliation');
const { canTransitionPayment, cents, exceptionReasons, receiptStatus } = require('../services/bursaryRules');
const { validIsoDate } = require('../services/studentRecordFormat');

const createSchema = z.object({
  award_id: z.string().uuid(),
  amount: z.coerce.number().finite().positive().max(9999999999.99),
  payment_method: z.string().trim().min(2).max(80),
  payment_reference: z.string().trim().max(150).optional().default(''),
  disbursement_date: z.string().refine(validIsoDate, 'Enter a valid payment date.').optional(),
});

const paymentStatusSchema = z.object({
  payment_status: z.enum(['cleared', 'failed', 'cancelled']),
  evidence_ref: z.string().trim().max(500).optional().default(''),
  notes: z.string().trim().max(2000).optional().default(''),
}).refine((value) => value.payment_status !== 'cleared' || value.evidence_ref.length > 0, {
  message: 'Evidence reference is required to record clearance',
  path: ['evidence_ref'],
}).refine((value) => value.payment_status === 'cleared' || value.notes.length >= 5, {
  message: 'Provide a reason for a failed or cancelled payment',
  path: ['notes'],
});

const acknowledgementSchema = z.object({
  acknowledged_amount: z.coerce.number().finite().min(0).max(9999999999.99),
  evidence_ref: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional().default(''),
});

const linkAwardSchema = z.object({
  award_id: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000),
});

async function list(req, res, next) {
  try {
    const rows = await Disbursement.getAll();
    res.json(rows.map((row) => ({
      ...row,
      exception_reasons: exceptionReasons(row, acknowledgementOverdueDays),
      acknowledgement_overdue_days: acknowledgementOverdueDays,
    })));
  } catch (error) {
    next(error);
  }
}

async function listExceptions(req, res, next) {
  try {
    const rows = await Disbursement.getAll();
    const exceptions = rows
      .map((row) => ({ ...row, exception_reasons: exceptionReasons(row, acknowledgementOverdueDays) }))
      .filter((row) => row.exception_reasons.length > 0);
    res.json({ deadline_days: acknowledgementOverdueDays, exceptions });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose an approved award, enter a valid amount and payment method.' });
  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sbms.student.registration'))");
    const awardResult = await client.query(
      'SELECT * FROM bursary_awards WHERE id = $1 FOR UPDATE',
      [parsed.data.award_id]
    );
    const award = awardResult.rows[0];
    if (!award) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (award.status !== 'approved' || award.verification_status !== 'verified') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only verified, approved awards can be disbursed.' });
    }
    const duplicate = await client.query(
      `SELECT id FROM duplicate_flags
       WHERE (student_id = $1 OR matched_student_id = $1)
         AND status IN ('pending', 'needs_verification', 'confirmed_duplicate')
       LIMIT 1`,
      [award.student_id]
    );
    if (duplicate.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Resolve duplicate review cases before disbursing this award.' });
    }
    const totals = await client.query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS total
       FROM disbursements WHERE award_id = $1 AND (payment_status IS NULL OR payment_status NOT IN ('failed', 'cancelled'))`,
      [award.id]
    );
    if (cents(totals.rows[0].total) + cents(parsed.data.amount) > cents(award.approved_amount)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Payment exceeds the remaining approved amount.' });
    }

    const disbursement = await Disbursement.create({
      student_id: award.student_id,
      award_id: award.id,
      amount: parsed.data.amount,
      disbursement_date: parsed.data.disbursement_date,
      created_by: actorId,
      payment_method: parsed.data.payment_method,
      payment_reference: parsed.data.payment_reference,
    }, client);
    await client.query(
      `INSERT INTO disbursement_reconciliation_events
         (disbursement_id, event_type, payment_status, receipt_status, amount, evidence_ref, actor_id)
       VALUES ($1, 'payment_issued', 'issued', 'awaiting_acknowledgement', $2, NULLIF($3, ''), $4)`,
      [disbursement.id, parsed.data.amount, parsed.data.payment_reference, actorId]
    );
    await logAudit(actorId, 'PAYMENT_ISSUED', 'disbursements', disbursement.id, {
      award_id: award.id,
      amount: parsed.data.amount,
      payment_method: parsed.data.payment_method,
      payment_reference: parsed.data.payment_reference || null,
    }, client);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Payment recorded as issued; clearance is not confirmed.', disbursement });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function updatePaymentStatus(req, res, next) {
  const parsed = paymentStatusSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Provide a valid status and required evidence or reason.' });
  const actorId = req.user.id || req.user.sub;
  const { payment_status, evidence_ref, notes } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM disbursements WHERE id = $1 FOR UPDATE', [req.params.id]);
    const payment = result.rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Payment not found.' });
    }
    if (!canTransitionPayment(payment.payment_status, payment_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This payment status cannot be changed.' });
    }
    if (['failed', 'cancelled'].includes(payment_status) && payment.receipt_status !== 'awaiting_acknowledgement') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'A payment with a receipt record cannot be failed or cancelled.' });
    }
    const updated = await client.query(
      `UPDATE disbursements SET payment_status = $1, status = $1,
         cleared_by = CASE WHEN $1 = 'cleared' THEN $2 ELSE NULL END,
         cleared_at = CASE WHEN $1 = 'cleared' THEN NOW() ELSE NULL END,
         clearance_evidence_ref = CASE WHEN $1 = 'cleared' THEN $3 ELSE NULL END
       WHERE id = $4 RETURNING *`,
      [payment_status, actorId, evidence_ref || null, payment.id]
    );
    const eventType = `payment_${payment_status}`;
    await client.query(
      `INSERT INTO disbursement_reconciliation_events
         (disbursement_id, event_type, payment_status, evidence_ref, notes, actor_id)
       VALUES ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6)`,
      [payment.id, eventType, payment_status, evidence_ref, notes, actorId]
    );
    await logAudit(actorId, `PAYMENT_${payment_status.toUpperCase()}`, 'disbursements', payment.id, {
      award_id: payment.award_id,
      evidence_ref: evidence_ref || null,
      notes: notes || null,
    }, client);
    await client.query('COMMIT');
    res.json({ message: `Payment marked ${payment_status}.`, disbursement: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function acknowledgeReceipt(req, res, next) {
  const parsed = acknowledgementSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Enter the received amount and evidence reference.' });
  const actorId = req.user.id || req.user.sub;
  const { acknowledged_amount, evidence_ref, notes } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM disbursements WHERE id = $1 FOR UPDATE', [req.params.id]);
    const payment = result.rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Payment not found.' });
    }
    if (['failed', 'cancelled'].includes(payment.payment_status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'A failed or cancelled payment cannot be acknowledged.' });
    }
    const receipt_status = receiptStatus(payment.amount, acknowledged_amount);
    const updated = await client.query(
      `UPDATE disbursements
       SET receipt_status = $1, acknowledged_amount = $2, acknowledged_by = $3,
           acknowledged_at = NOW(), acknowledgement_method = 'officer_assisted',
           acknowledgement_evidence_ref = $4, acknowledgement_notes = NULLIF($5, '')
       WHERE id = $6 RETURNING *`,
      [receipt_status, acknowledged_amount, actorId, evidence_ref, notes, payment.id]
    );
    await client.query(
      `INSERT INTO disbursement_reconciliation_events
         (disbursement_id, event_type, receipt_status, amount, evidence_ref, notes, actor_id)
       VALUES ($1, 'receipt_acknowledged', $2, $3, $4, NULLIF($5, ''), $6)`,
      [payment.id, receipt_status, acknowledged_amount, evidence_ref, notes, actorId]
    );
    await logAudit(actorId, 'RECEIPT_ACKNOWLEDGED_OFFICER_ASSISTED', 'disbursements', payment.id, {
      award_id: payment.award_id,
      receipt_status,
      disbursed_amount: payment.amount,
      acknowledged_amount,
      evidence_ref,
    }, client);
    await client.query('COMMIT');
    res.json({
      message: receipt_status === 'acknowledged'
        ? 'Officer-assisted receipt record saved.'
        : 'Amount discrepancy recorded for follow-up.',
      disbursement: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function linkLegacyPayment(req, res, next) {
  const parsed = linkAwardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose an award and explain the link.' });
  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const paymentResult = await client.query('SELECT * FROM disbursements WHERE id = $1 FOR UPDATE', [req.params.id]);
    const payment = paymentResult.rows[0];
    if (!payment) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Payment not found.' });
    }
    if (payment.award_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This payment is already linked to an award.' });
    }
    const awardResult = await client.query('SELECT * FROM bursary_awards WHERE id = $1 FOR UPDATE', [parsed.data.award_id]);
    const award = awardResult.rows[0];
    if (!award) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (award.student_id !== payment.student_id || award.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Link only to an approved award for the same student.' });
    }
    const updated = await client.query(
      'UPDATE disbursements SET award_id = $1 WHERE id = $2 RETURNING *',
      [award.id, payment.id]
    );
    await client.query(
      `INSERT INTO disbursement_reconciliation_events
         (disbursement_id, event_type, amount, notes, actor_id)
       VALUES ($1, 'payment_linked_to_award', $2, $3, $4)`,
      [payment.id, payment.amount, parsed.data.reason, actorId]
    );
    await logAudit(actorId, 'LEGACY_PAYMENT_LINKED_TO_AWARD', 'disbursements', payment.id, {
      award_id: award.id,
      reason: parsed.data.reason,
    }, client);
    await client.query('COMMIT');
    res.json({ message: 'Payment linked. Verify its status and receipt separately.', disbursement: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { acknowledgeReceipt, create, linkLegacyPayment, list, listExceptions, updatePaymentStatus };
