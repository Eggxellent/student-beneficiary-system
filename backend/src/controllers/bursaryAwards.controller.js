const { z } = require('zod');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const { issueForApprovedAward } = require('../services/certificateIssue');
const { notifyAwardSubmitted, notifyAwardDecision } = require('../services/notifications');

const createSchema = z.object({
  student_id: z.string().uuid(),
  requested_amount: z.coerce.number().finite().positive().max(9999999999.99),
  // A second bursary is allowed, but only after the officer acknowledges the existing allocation.
  // The frontend asks first; this flag is the officer's answer travelling with the request.
  confirm_duplicate_allocation: z.boolean().optional(),
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
              proposer.full_name AS submitted_by_name,
              decider.full_name AS decided_by_name,
              cert.certificate_reference,
              COALESCE(duplicates.open_count, 0)::int AS open_duplicate_count
       FROM bursary_awards a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users proposer ON proposer.id = a.submitted_by
       LEFT JOIN users decider ON decider.id = a.decided_by
       LEFT JOIN bursary_certificates cert ON cert.award_id = a.id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS open_count FROM duplicate_flags f
         WHERE (f.student_id = a.student_id OR f.matched_student_id = a.student_id)
           AND f.status IN ('pending', 'needs_verification', 'confirmed_duplicate')
       ) duplicates ON TRUE
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
      'SELECT id, full_name, school_code FROM students WHERE id = $1 FOR UPDATE',
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

    // Serialise proposal creation per student: two accidental clicks then queue behind each other
    // instead of both reading "no allocation" and inserting two rows.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [parsed.data.student_id]);

    // One bursary per student is no longer enforced here. An existing allocation (approved, or still
    // awaiting a decision) is reported so the officer can confirm; only a confirmed request may add
    // a second proposal. Rejected proposals are ignored, as before.
    const existing = await client.query(
      `SELECT id, status, approved_amount, requested_amount, submitted_by, created_at
       FROM bursary_awards
       WHERE student_id = $1 AND status <> 'rejected'
       ORDER BY created_at DESC LIMIT 1`,
      [parsed.data.student_id]
    );
    const existingAward = existing.rows[0];
    if (existingAward) {
      const ageMs = Date.now() - new Date(existingAward.created_at).getTime();
      const accidentalRepeat = existingAward.status === 'submitted'
        && existingAward.submitted_by === actorId
        && Number(existingAward.requested_amount) === parsed.data.requested_amount
        && ageMs < 60_000;
      if (accidentalRepeat) {
        // The same officer just created this proposal: answer idempotently instead of queueing a twin.
        await client.query('ROLLBACK');
        return res.status(200).json({
          message: 'This proposal was already submitted.',
          already_submitted: true,
          award: existingAward,
        });
      }
      if (!parsed.data.confirm_duplicate_allocation) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'EXISTING_ALLOCATION',
          message: existingAward.status === 'approved'
            ? 'This student has already been allocated a bursary. Are you sure you want to proceed with another bursary proposal?'
            : 'This student already has a bursary proposal awaiting a decision. Are you sure you want to proceed with another bursary proposal?',
          existing_award: {
            id: existingAward.id,
            status: existingAward.status,
            requested_amount: existingAward.requested_amount,
            approved_amount: existingAward.approved_amount,
            created_at: existingAward.created_at,
          },
        });
      }
    }

    const { rows } = await client.query(
      `INSERT INTO bursary_awards (student_id, school_code, requested_amount, submitted_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [parsed.data.student_id, student.rows[0].school_code, parsed.data.requested_amount, actorId]
    );
    await logAudit(actorId, 'AWARD_SUBMITTED', 'bursary_awards', rows[0].id, {
      requested_amount: rows[0].requested_amount,
      school_code: rows[0].school_code,
      ...(existingAward ? {
        duplicate_allocation_confirmed: true,
        existing_award_id: existingAward.id,
        existing_award_status: existingAward.status,
      } : {}),
    }, client);
    // The reviewers are the only people who can act on a proposal, so they are the only ones
    // notified. The proposing officer already knows: they just submitted it.
    await notifyAwardSubmitted(client, { award: rows[0], studentName: student.rows[0].full_name });
    await client.query('COMMIT');
    // The stored status stays 'submitted', but the officer has only *proposed* an amount. Nothing
    // is awarded until an administrator approves it, and the wording says so.
    res.status(201).json({ message: 'Award proposed. It awaits an administrator decision.', award: rows[0] });
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
    // Separation of duties: the officer who proposed the amount must not be the officer who
    // approves it, even if their role was later raised to administrator. The route guard already
    // keeps submission and decision in different roles; this check keeps the rule true for the
    // data, not only for the current role table.
    if (decision === 'approved' && award.submitted_by && award.submitted_by === actorId) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'The officer who proposed an award cannot approve it. A different authorised officer must decide.' });
    }
    if (decision === 'approved') {
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
    // The student row is read once for both outcomes: the approver needs the full record for the
    // certificate, and the rejection notification still has to name who it concerns.
    const { rows: students } = await client.query(
      'SELECT full_name, upi, school_code FROM students WHERE id = $1',
      [award.student_id]
    );
    const studentName = students[0]?.full_name || 'Beneficiary record';
    const updated = await client.query(
      `UPDATE bursary_awards
       SET status = $1, approved_amount = $2, decision_reason = $3,
           decided_by = $4, decided_at = NOW(), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [decision, decision === 'approved' ? approved_amount : null, reason, actorId, req.params.id]
    );
    // Approval produces the certificate in the same transaction: an approved award without one
    // would mean the proposing officer has nothing to print for the student. Rejection produces
    // nothing, and a later decision cannot be made because `status` is no longer 'submitted'.
    let certificate = null;
    if (decision === 'approved') {
      if (!students.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'The student record for this award is missing.' });
      }
      certificate = await issueForApprovedAward(client, {
        award: updated.rows[0],
        student: students[0],
        actorId,
      });
    }
    await logAudit(actorId, `AWARD_${decision.toUpperCase()}`, 'bursary_awards', req.params.id, {
      approved_amount: decision === 'approved' ? approved_amount : null,
      reason,
    }, client);
    // The proposing officer learns the outcome; the administrator who decided does not need a
    // notification for the action they just took. Certificate issuance notifies separately, from
    // the service that writes the certificate, so both issuance paths behave the same.
    await notifyAwardDecision(client, {
      award: updated.rows[0],
      studentName,
      decision,
      approvedAmount: decision === 'approved' ? approved_amount : null,
    });
    await client.query('COMMIT');
    res.json({
      message: decision === 'approved'
        ? `Award approved. Certificate ${certificate.certificate_reference} was generated for the proposing field officer to print and issue.`
        : 'Award rejected.',
      award: updated.rows[0],
      certificate_reference: certificate ? certificate.certificate_reference : null,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { create, decide, list };
