const { z } = require('zod');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');

const createSchema = z.object({
  student_id: z.string().uuid(),
  requested_amount: z.coerce.number().finite().positive().max(9999999999.99),
});

const verificationSchema = z.object({
  outcome: z.enum(['verified', 'not_found', 'needs_investigation']),
  notes: z.string().trim().min(5).max(2000),
  evidence_ref: z.string().trim().max(500).optional().default(''),
}).refine((value) => value.outcome !== 'verified' || value.evidence_ref.length > 0, {
  message: 'Evidence reference is required for a verified outcome',
  path: ['evidence_ref'],
});

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  approved_amount: z.coerce.number().finite().positive().max(9999999999.99).optional(),
  reason: z.string().trim().min(5).max(2000),
}).refine((value) => value.decision !== 'approved' || value.approved_amount !== undefined, {
  message: 'Approved amount is required',
  path: ['approved_amount'],
});

async function list(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, s.full_name AS student_name, s.upi,
              COALESCE(payments.total_disbursed, 0)::numeric AS total_disbursed,
              COALESCE(payments.payment_count, 0)::int AS payment_count,
              COALESCE(duplicates.open_count, 0)::int AS open_duplicate_count,
              COALESCE(history.events, '[]'::jsonb) AS verification_history
       FROM bursary_awards a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN LATERAL (
         SELECT SUM(d.amount) AS total_disbursed, COUNT(*) AS payment_count
         FROM disbursements d WHERE d.award_id = a.id
           AND (d.payment_status IS NULL OR d.payment_status NOT IN ('failed', 'cancelled'))
       ) payments ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS open_count FROM duplicate_flags f
         WHERE (f.student_id = a.student_id OR f.matched_student_id = a.student_id)
           AND f.status IN ('pending', 'needs_verification', 'confirmed_duplicate')
       ) duplicates ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
           'outcome', e.outcome, 'notes', e.notes, 'evidence_ref', e.evidence_ref,
           'actor_name', u.full_name, 'created_at', e.created_at
         ) ORDER BY e.created_at DESC) AS events
         FROM bursary_award_verification_events e JOIN users u ON u.id = e.actor_id
         WHERE e.award_id = a.id
       ) history ON TRUE
       ORDER BY a.created_at DESC`
    );
    res.json({ awards: rows });
  } catch (error) {
    next(error);
  }
}

async function create(req, res, next) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose a student and enter a positive requested amount.' });

  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const student = await client.query(
      'SELECT id, school_code FROM students WHERE id = $1 FOR UPDATE',
      [parsed.data.student_id]
    );
    if (!student.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student not found.' });
    }
    if (!student.rows[0].school_code) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Add the student’s school before submitting an award.' });
    }

    const { rows } = await client.query(
      `INSERT INTO bursary_awards (student_id, school_code, requested_amount, submitted_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [parsed.data.student_id, student.rows[0].school_code, parsed.data.requested_amount, actorId]
    );
    await logAudit(actorId, 'AWARD_SUBMITTED', 'bursary_awards', rows[0].id, {
      requested_amount: rows[0].requested_amount,
      school_code: rows[0].school_code,
    }, client);
    await client.query('COMMIT');
    res.status(201).json({ message: 'Award submitted.', award: rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function recordVerification(req, res, next) {
  const parsed = verificationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Provide an outcome, notes, and evidence for verified cases.' });
  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const award = await client.query(
      "SELECT id, status FROM bursary_awards WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );
    if (!award.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (award.rows[0].status !== 'submitted') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Verification is closed after an award decision.' });
    }
    const { outcome, notes, evidence_ref } = parsed.data;
    await client.query(
      `INSERT INTO bursary_award_verification_events (award_id, outcome, notes, evidence_ref, actor_id)
       VALUES ($1, $2, $3, NULLIF($4, ''), $5)`,
      [req.params.id, outcome, notes, evidence_ref, actorId]
    );
    const updated = await client.query(
      `UPDATE bursary_awards
       SET verification_status = $1, verification_notes = $2,
           verification_evidence_ref = NULLIF($3, ''), verified_by = $4,
           verified_at = NOW(), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [outcome, notes, evidence_ref, actorId, req.params.id]
    );
    await logAudit(actorId, 'AWARD_VERIFICATION_RECORDED', 'bursary_awards', req.params.id, {
      outcome,
      evidence_ref: evidence_ref || null,
    }, client);
    await client.query('COMMIT');
    res.json({ message: 'Verification recorded.', award: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

async function decide(req, res, next) {
  const parsed = decisionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose approve or reject and provide a reason.' });
  const actorId = req.user.id || req.user.sub;
  const { decision, reason, approved_amount } = parsed.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sbms.student.registration'))");
    const { rows: awards } = await client.query(
      'SELECT * FROM bursary_awards WHERE id = $1 FOR UPDATE',
      [req.params.id]
    );
    const award = awards[0];
    if (!award) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (award.status !== 'submitted') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This award already has a decision.' });
    }
    if (decision === 'approved') {
      if (award.verification_status !== 'verified') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Verify the beneficiary before approving this award.' });
      }
      const duplicates = await client.query(
        `SELECT id FROM duplicate_flags
         WHERE (student_id = $1 OR matched_student_id = $1)
           AND status IN ('pending', 'needs_verification', 'confirmed_duplicate')
         LIMIT 1`,
        [award.student_id]
      );
      if (duplicates.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Resolve duplicate review cases before approving this award.' });
      }
    }
    const updated = await client.query(
      `UPDATE bursary_awards
       SET status = $1, approved_amount = $2, decision_reason = $3,
           decided_by = $4, decided_at = NOW(), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [decision, decision === 'approved' ? approved_amount : null, reason, actorId, req.params.id]
    );
    await logAudit(actorId, `AWARD_${decision.toUpperCase()}`, 'bursary_awards', req.params.id, {
      approved_amount: decision === 'approved' ? approved_amount : null,
      reason,
    }, client);
    await client.query('COMMIT');
    res.json({ message: `Award ${decision}.`, award: updated.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { create, decide, list, recordVerification };
