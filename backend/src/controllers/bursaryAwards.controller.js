const { z } = require('zod');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const { issueForApprovedAward } = require('../services/certificateIssue');
const { notifyAwardSubmitted, notifyAwardDecision } = require('../services/notifications');
const { loadEligibilityWorkflow, awardReadinessError } = require('../services/eligibilityWorkflow');

const createSchema = z.object({
  student_id: z.string().uuid(),
  requested_amount: z.coerce.number().finite().positive().max(9999999999.99),
});

const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  approved_amount: z.coerce.number().finite().positive().max(9999999999.99).optional(),
  reason: z.string().trim().min(5).max(2000),
}).refine((value) => value.decision !== 'approved' || value.approved_amount !== undefined, {
  message: 'Approved amount is required',
  path: ['approved_amount'],
});

const reportSchema = z.object({
  reason: z.string().trim().min(5).max(2000),
});

const correctionSchema = z.object({
  approved_amount: z.coerce.number().finite().positive().max(9999999999.99).optional(),
  requested_amount: z.coerce.number().finite().positive().max(9999999999.99).optional(),
  school_code: z.string().trim().min(2).max(100).optional(),
  reason: z.string().trim().min(5).max(2000),
}).refine((value) => value.approved_amount !== undefined
  || value.requested_amount !== undefined
  || value.school_code !== undefined, {
  message: 'Enter the value that should be corrected',
  path: ['approved_amount'],
});

const voidSchema = z.object({
  reason: z.string().trim().min(5).max(2000),
});

// The award year is the calendar year the proposal was made in. Storing it (rather than deriving it
// from created_at on every read) lets the database enforce the annual rule with a unique index.
function currentAwardYear() {
  return new Date().getUTCFullYear();
}

// A report stays open until a correction or a void is written after it. The award row itself only
// records the outcome (`voided_at`); the events table holds the sequence.
const OPEN_REPORT_SQL = `
  SELECT r.id, r.reason, r.created_at, r.actor_id, reporter.full_name AS reported_by_name
  FROM bursary_award_correction_events r
  LEFT JOIN users reporter ON reporter.id = r.actor_id
  WHERE r.award_id = $1 AND r.event_type = 'error_reported'
    AND NOT EXISTS (
      SELECT 1 FROM bursary_award_correction_events resolved
      WHERE resolved.award_id = r.award_id
        AND resolved.event_type IN ('award_corrected', 'award_voided')
        AND resolved.created_at >= r.created_at
    )
  ORDER BY r.created_at DESC
  LIMIT 1`;


async function list(req, res, next) {
  try {
    // The award list is shared with Field Officers. Their view must not reveal a student who is
    // held by an open or unresolved duplicate case, so the same rule as the student roster is
    // applied here rather than relying on the client to hide the row.
    const hideDuplicateStudents = req.user?.role === 'field_officer';
    const { rows } = await pool.query(
      `SELECT a.*, s.full_name AS student_name, s.upi,
              s.duplicate_of_student_id AS student_duplicate_of_student_id,
              proposer.full_name AS submitted_by_name,
              decider.full_name AS decided_by_name,
              voider.full_name AS voided_by_name,
              cert.certificate_reference,
              report.id AS open_report_id,
              report.reason AS open_report_reason,
              report.created_at AS open_report_at,
              report.reported_by_name AS open_report_reported_by_name,
              COALESCE(duplicates.open_count, 0)::int AS open_duplicate_count
       FROM bursary_awards a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN users proposer ON proposer.id = a.submitted_by
       LEFT JOIN users decider ON decider.id = a.decided_by
       LEFT JOIN users voider ON voider.id = a.voided_by
       LEFT JOIN bursary_certificates cert ON cert.award_id = a.id
       LEFT JOIN LATERAL (${OPEN_REPORT_SQL.replace('$1', 'a.id')}) report ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS open_count FROM duplicate_flags f
         LEFT JOIN duplicate_resolutions resolved ON resolved.duplicate_flag_id = f.id
         WHERE (f.student_id = a.student_id OR f.matched_student_id = a.student_id)
           AND (f.status IN ('pending', 'needs_verification')
                OR (f.status = 'confirmed_duplicate' AND resolved.id IS NULL))
       ) duplicates ON TRUE
       WHERE $1::boolean = FALSE
          OR (s.duplicate_of_student_id IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM duplicate_flags f
                 WHERE (f.student_id = a.student_id OR f.matched_student_id = a.student_id)
                   AND (f.status IN ('pending', 'needs_verification')
                        OR (f.status = 'confirmed_duplicate'
                            AND NOT EXISTS (
                              SELECT 1 FROM duplicate_resolutions r WHERE r.duplicate_flag_id = f.id
                            )))
              ))
       ORDER BY a.created_at DESC`,
      [hideDuplicateStudents]
    );
    res.json({ awards: rows });
  } catch (error) {
    next(error);
  }
}

// A saved value that was never recorded stays null; Number(null) would quietly become 0 and make an
// unknown fee balance or household income look like a real zero on the review screen.
function savedNumber(value) {
  return value == null ? null : Number(value);
}

// The administrator's decision has to be informed by the eligibility assessment that was actually
// saved for this student. It is read from the database in one query and never recalculated here; if
// no assessment exists the response says so instead of inventing one.
async function detail(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, s.full_name AS student_name, s.upi, s.school_code,
              s.duplicate_of_student_id AS student_duplicate_of_student_id,
              duplicate.full_name AS duplicate_of_student_name,
              e.score AS eligibility_score, e.category AS eligibility_category,
              e.fee_balance, e.household_income, e.vulnerability_status,
              e.siblings_in_school, e.prior_bursary_history,
              e.recommended_min, e.recommended_max, e.recommended_currency,
              e.recommendation_provisional, e.recommendation_source, e.recorded_via,
              e.assessed_at, e.assessed_by_name,
              c.id AS duplicate_case_id, c.status AS duplicate_case_status,
              r.id AS duplicate_resolution_id, r.reason AS duplicate_resolution_reason,
              r.resolved_at AS duplicate_resolution_at,
              resolver.full_name AS duplicate_resolved_by_name,
              r.canonical_student_id, r.duplicate_student_id
       FROM bursary_awards a
       JOIN students s ON s.id = a.student_id
       LEFT JOIN students duplicate ON duplicate.id = s.duplicate_of_student_id
       LEFT JOIN LATERAL (
         SELECT ea.*, assessor.full_name AS assessed_by_name
         FROM eligibility_assessments ea
         LEFT JOIN users assessor ON assessor.id = ea.assessed_by
         WHERE ea.student_id = a.student_id AND ea.status = 'complete'
         ORDER BY ea.assessed_at DESC, ea.created_at DESC
         LIMIT 1
       ) e ON TRUE
       LEFT JOIN LATERAL (
         SELECT f.id, f.status FROM duplicate_flags f
         WHERE f.student_id = a.student_id OR f.matched_student_id = a.student_id
         ORDER BY f.created_at DESC
         LIMIT 1
       ) c ON TRUE
       LEFT JOIN duplicate_resolutions r ON r.duplicate_flag_id = c.id
       LEFT JOIN users resolver ON resolver.id = r.resolved_by
       WHERE a.id = $1`,
      [req.params.id]
    );
    const award = rows[0];
    if (!award) return res.status(404).json({ message: 'Award not found.' });

    const eligibility = award.assessed_at ? {
      score: award.eligibility_score,
      max_score: 100,
      category: award.eligibility_category,
      fee_balance: savedNumber(award.fee_balance),
      household_income: savedNumber(award.household_income),
      vulnerability_status: award.vulnerability_status,
      siblings_in_school: award.siblings_in_school,
      prior_bursary_history: award.prior_bursary_history,
      recommended_range: {
        currency: award.recommended_currency,
        min: award.recommended_min == null ? null : Number(award.recommended_min),
        max: award.recommended_max == null ? null : Number(award.recommended_max),
        provisional: award.recommendation_provisional,
        source: award.recommendation_source,
      },
      recorded_via: award.recorded_via,
      assessed_at: award.assessed_at,
      assessed_by_name: award.assessed_by_name,
    } : null;

    res.json({
      award,
      student: {
        id: award.student_id,
        full_name: award.student_name,
        upi: award.upi,
        school_code: award.school_code,
        duplicate_of_student_id: award.student_duplicate_of_student_id,
        duplicate_of_student_name: award.duplicate_of_student_name,
      },
      eligibility,
      duplicate_case: award.duplicate_case_id ? {
        id: award.duplicate_case_id,
        status: award.duplicate_case_status,
        resolution: award.duplicate_resolution_id ? {
          id: award.duplicate_resolution_id,
          canonical_student_id: award.canonical_student_id,
          duplicate_student_id: award.duplicate_student_id,
          reason: award.duplicate_resolution_reason,
          resolved_at: award.duplicate_resolution_at,
          resolved_by_name: award.duplicate_resolved_by_name,
        } : null,
      } : null,
    });
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
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sbms.student.registration'))");
    const student = await client.query(
      `SELECT s.id, s.full_name, s.school_code, s.duplicate_of_student_id,
              EXISTS (
                SELECT 1 FROM guardian_applications a
                 WHERE a.student_id = s.id
                   AND NOT EXISTS (
                     SELECT 1 FROM audit_logs screening
                      WHERE screening.table_name = 'guardian_applications'
                        AND screening.record_id = a.id
                        AND screening.action = 'GUARDIAN_APPLICATION_LINKED_STUDENT'
                   )
              ) AS has_unscreened_guardian_application,
              EXISTS (
                SELECT 1 FROM duplicate_flags f
                 WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
                   AND f.status IN ('pending', 'needs_verification')
              ) AS has_open_case,
              EXISTS (
                SELECT 1 FROM duplicate_flags f
                 WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
                   AND f.status = 'confirmed_duplicate'
                   AND NOT EXISTS (
                     SELECT 1 FROM duplicate_resolutions r WHERE r.duplicate_flag_id = f.id
                   )
              ) AS has_confirmed_case
         FROM students s WHERE s.id = $1 FOR UPDATE`,
      [parsed.data.student_id]
    );
    if (!student.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Student not found.' });
    }
    const readiness = await loadEligibilityWorkflow(client, parsed.data.student_id);
    const readinessError = awardReadinessError(readiness);
    if (readinessError) {
      await client.query('ROLLBACK');
      return res.status(readinessError.status).json(readinessError);
    }
    if (student.rows[0].has_unscreened_guardian_application) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'DUPLICATE_SCREENING_REQUIRED',
        message: 'A bursary proposal requires explicit duplicate-screening clearance first.',
      });
    }
    // A record already resolved as a duplicate never receives its own award.
    if (student.rows[0].duplicate_of_student_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'DUPLICATE_RECORD',
        message: 'This student record is marked as a duplicate of another record. Propose the bursary against the canonical record instead; a duplicate record cannot receive an award.',
        canonical_student_id: student.rows[0].duplicate_of_student_id,
      });
    }
    // A student held by an open or unresolved duplicate case cannot be proposed for an award: the
    // eligibility assessment that would support the amount is blocked by the same rule, and acting
    // on the record would let the award screen bypass the duplicate queue.
    if (student.rows[0].has_open_case || student.rows[0].has_confirmed_case) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'ELIGIBILITY_BLOCKED_BY_DUPLICATE',
        message: 'This student has an unresolved or confirmed duplicate case. A bursary cannot be proposed until an administrator resolves it.',
      });
    }
    if (!student.rows[0].school_code) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Add the student’s school before submitting an award.' });
    }

    // Serialise proposal creation per student: two accidental clicks then queue behind each other
    // instead of both reading "no allocation" and inserting two rows.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [parsed.data.student_id]);

    // One bursary per student per calendar year. The check below gives the officer a readable answer;
    // the partial unique index on (student_id, award_year) is what actually holds when two requests
    // arrive at once, because the INSERT is the only place both transactions can collide.
    const awardYear = currentAwardYear();
    const existing = await client.query(
      `SELECT id, student_id, status, approved_amount, requested_amount, submitted_by, award_year, created_at
       FROM bursary_awards
       WHERE student_id IN (SELECT id FROM students WHERE id = $1 OR duplicate_of_student_id = $1)
         AND award_year = $2 AND status IN ('submitted', 'approved')
       ORDER BY created_at DESC LIMIT 1`,
      [parsed.data.student_id, awardYear]
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
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'ANNUAL_AWARD_EXISTS',
        message: existingAward.status === 'approved'
          ? `This student already received an approved bursary for ${awardYear}. A student can only receive one bursary per calendar year. If that award is wrong, report the error so an administrator can correct or void it.`
          : `This student already has a bursary proposal awaiting a decision for ${awardYear}. A student can only receive one bursary per calendar year.`,
        existing_award: {
          id: existingAward.id,
          status: existingAward.status,
          award_year: existingAward.award_year,
          requested_amount: existingAward.requested_amount,
          approved_amount: existingAward.approved_amount,
          created_at: existingAward.created_at,
        },
      });
    }

    const { rows } = await client.query(
      `INSERT INTO bursary_awards (student_id, school_code, requested_amount, submitted_by, award_year)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [parsed.data.student_id, student.rows[0].school_code, parsed.data.requested_amount, actorId, awardYear]
    );
    await logAudit(actorId, 'AWARD_SUBMITTED', 'bursary_awards', rows[0].id, {
      requested_amount: rows[0].requested_amount,
      school_code: rows[0].school_code,
      award_year: awardYear,
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
    // A concurrent request won the race after the check above read no row. The unique index rejected
    // this insert, and the officer gets the same answer as the sequential path.
    if (error.code === '23505' && /bursary_awards_student_year_active_unique/.test(error.constraint || '')) {
      return res.status(409).json({
        code: 'ANNUAL_AWARD_EXISTS',
        message: `This student already has a bursary award for ${currentAwardYear()}. A student can only receive one bursary per calendar year. If that award is wrong, report the error so an administrator can correct or void it.`,
      });
    }
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
      const readiness = await loadEligibilityWorkflow(client, award.student_id);
      const readinessError = awardReadinessError(readiness);
      if (readinessError) {
        await client.query('ROLLBACK');
        return res.status(readinessError.status).json(readinessError);
      }
      const studentsForDuplicateCheck = await client.query(
        `SELECT s.duplicate_of_student_id,
                EXISTS (
                  SELECT 1 FROM guardian_applications a
                   WHERE a.student_id = s.id
                     AND NOT EXISTS (
                       SELECT 1 FROM audit_logs screening
                        WHERE screening.table_name = 'guardian_applications'
                          AND screening.record_id = a.id
                          AND screening.action = 'GUARDIAN_APPLICATION_LINKED_STUDENT'
                     )
                ) AS has_unscreened_guardian_application
           FROM students s WHERE s.id = $1`,
        [award.student_id]
      );
      if (studentsForDuplicateCheck.rows[0]?.has_unscreened_guardian_application) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'DUPLICATE_SCREENING_REQUIRED',
          message: 'This application cannot be approved for a bursary until duplicate screening is explicitly cleared.',
        });
      }
      // A record resolved as a duplicate can never receive its own award; only the canonical record
      // the administrator designated may proceed.
      if (studentsForDuplicateCheck.rows[0]?.duplicate_of_student_id) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'DUPLICATE_RECORD',
          message: 'This student record is marked as a duplicate of another record. Only the canonical record can receive a bursary.',
        });
      }
      const duplicates = await client.query(
        `SELECT f.id FROM duplicate_flags f
         LEFT JOIN duplicate_resolutions resolved ON resolved.duplicate_flag_id = f.id
         WHERE (f.student_id = $1 OR f.matched_student_id = $1)
           AND (f.status IN ('pending', 'needs_verification')
                OR (f.status = 'confirmed_duplicate' AND resolved.id IS NULL))
         LIMIT 1`,
        [award.student_id]
      );
      if (duplicates.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Resolve duplicate review cases before approving this award.' });
      }
      // The annual rule spans the resolved identity: a record resolved as a duplicate of this
      // student cannot hold a second bursary for the same year.
      const conflicting = await client.query(
        `SELECT a.id FROM bursary_awards a
         WHERE a.id <> $1 AND a.award_year = $2 AND a.status IN ('submitted', 'approved')
           AND a.student_id IN (SELECT id FROM students WHERE duplicate_of_student_id = $3)
         LIMIT 1`,
        [award.id, award.award_year, award.student_id]
      );
      if (conflicting.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'RESOLVED_DUPLICATE_AWARD_EXISTS',
          message: 'A student record resolved as a duplicate of this student already has a bursary for this calendar year. One bursary per student per year applies across the resolved records; reject or void the other award first.',
        });
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
        ? `Award approved. Bursary approval invoice ${certificate.certificate_reference} was generated for the proposing field officer to print and issue.`
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

// A field officer who spots a mistake reports it; the award itself does not change and the student's
// year stays occupied until an administrator resolves the report. This is the replacement for the
// old "propose another award anyway" escape hatch, which the annual rule now refuses.
async function reportError(req, res, next) {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Describe the error in at least 5 characters.' });
  }
  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM bursary_awards WHERE id = $1 FOR UPDATE', [req.params.id]);
    const award = rows[0];
    if (!award) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (!['submitted', 'approved'].includes(award.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only a proposed or approved award can be reported. A rejected or voided award is already closed.' });
    }
    // The same ownership rule the invoice endpoints use: an officer acts on the awards they proposed.
    if (req.user.role === 'field_officer' && award.submitted_by !== actorId) {
      await client.query('ROLLBACK');
      return res.status(403).json({ message: 'You can only report an error in an award you proposed.' });
    }
    const openReport = await client.query(OPEN_REPORT_SQL, [award.id]);
    if (openReport.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This award already has an error report awaiting an administrator.' });
    }
    const created = await client.query(
      `INSERT INTO bursary_award_correction_events (award_id, event_type, reason, changes, actor_id)
       VALUES ($1, 'error_reported', $2, NULL, $3)
       RETURNING id, reason, created_at`,
      [award.id, parsed.data.reason, actorId]
    );
    await logAudit(actorId, 'AWARD_ERROR_REPORTED', 'bursary_awards', award.id, {
      reason: parsed.data.reason,
      status: award.status,
      approved_amount: award.approved_amount,
      award_year: award.award_year,
    }, client);
    await client.query('COMMIT');
    res.status(201).json({
      message: 'Error reported. An administrator will review the award before it is corrected or voided.',
      report: created.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

// Correcting keeps the award alive and keeps the year occupied: the student still has their one
// bursary, now with the right amount. The previous values survive in the event row and the audit log.
async function correct(req, res, next) {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Enter the corrected value and a reason of at least 5 characters.' });
  }
  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM bursary_awards WHERE id = $1 FOR UPDATE', [req.params.id]);
    const award = rows[0];
    if (!award) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (award.status !== 'approved') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only an approved award can be corrected. A proposal is decided; a voided award cannot be changed.' });
    }
    const openReport = await client.query(OPEN_REPORT_SQL, [award.id]);
    if (!openReport.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'No error report is awaiting resolution for this award.' });
    }
    const changes = {};
    if (parsed.data.approved_amount !== undefined && Number(award.approved_amount) !== parsed.data.approved_amount) {
      changes.approved_amount = { from: Number(award.approved_amount), to: parsed.data.approved_amount };
    }
    if (parsed.data.requested_amount !== undefined && Number(award.requested_amount) !== parsed.data.requested_amount) {
      changes.requested_amount = { from: Number(award.requested_amount), to: parsed.data.requested_amount };
    }
    if (parsed.data.school_code !== undefined && award.school_code !== parsed.data.school_code) {
      changes.school_code = { from: award.school_code, to: parsed.data.school_code };
    }
    if (!Object.keys(changes).length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'The corrected value matches the recorded value, so nothing changed.' });
    }
    const updated = await client.query(
      `UPDATE bursary_awards
       SET requested_amount = COALESCE($1, requested_amount),
           approved_amount = COALESCE($2, approved_amount),
           school_code = COALESCE($3, school_code),
           corrected_by = $4, corrected_at = NOW(), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [
        parsed.data.requested_amount === undefined ? null : parsed.data.requested_amount,
        parsed.data.approved_amount === undefined ? null : parsed.data.approved_amount,
        parsed.data.school_code === undefined ? null : parsed.data.school_code,
        actorId,
        award.id,
      ]
    );
    await client.query(
      `INSERT INTO bursary_award_correction_events (award_id, event_type, reason, changes, actor_id)
       VALUES ($1, 'award_corrected', $2, $3, $4)`,
      [award.id, parsed.data.reason, JSON.stringify(changes), actorId]
    );
    await logAudit(actorId, 'AWARD_CORRECTED', 'bursary_awards', award.id, {
      reason: parsed.data.reason,
      changes,
      award_year: award.award_year,
    }, client);
    await client.query('COMMIT');
    res.json({
      message: `Award corrected. It still counts as the student's bursary for ${award.award_year}.`,
      award: updated.rows[0],
      changes,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

// Voiding closes the award without deleting it. Because the unique index only covers pending and
// approved rows, the student becomes eligible again for the same calendar year as soon as this
// transaction commits — not before.
async function voidAward(req, res, next) {
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Give a reason for voiding the award, at least 5 characters.' });
  }
  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM bursary_awards WHERE id = $1 FOR UPDATE', [req.params.id]);
    const award = rows[0];
    if (!award) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Award not found.' });
    }
    if (!['submitted', 'approved'].includes(award.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This award is already closed and cannot be voided.' });
    }
    const openReport = await client.query(OPEN_REPORT_SQL, [award.id]);
    if (!openReport.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'No error report is awaiting resolution for this award.' });
    }
    // Money already recorded against the award would be left pointing at a voided decision.
    const payments = await client.query(
      `SELECT 1 FROM disbursements
       WHERE award_id = $1 AND payment_status IN ('issued', 'cleared')
       LIMIT 1`,
      [award.id]
    );
    if (payments.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Payments recorded against this award must be reconciled before it can be voided.' });
    }
    const updated = await client.query(
      `UPDATE bursary_awards
       SET status = 'voided', void_reason = $1, voided_by = $2, voided_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [parsed.data.reason, actorId, award.id]
    );
    await client.query(
      `INSERT INTO bursary_award_correction_events (award_id, event_type, reason, changes, actor_id)
       VALUES ($1, 'award_voided', $2, $3, $4)`,
      [award.id, parsed.data.reason, JSON.stringify({ status: { from: award.status, to: 'voided' } }), actorId]
    );
    await logAudit(actorId, 'AWARD_VOIDED', 'bursary_awards', award.id, {
      reason: parsed.data.reason,
      previous_status: award.status,
      approved_amount: award.approved_amount,
      award_year: award.award_year,
    }, client);
    await client.query('COMMIT');
    res.json({
      message: `Award voided. The student can be considered for another bursary in ${award.award_year}. The voided record is kept for the audit trail.`,
      award: updated.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { create, decide, detail, list, reportError, correct, voidAward };
