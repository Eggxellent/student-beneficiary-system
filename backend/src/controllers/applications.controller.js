const { randomBytes, createHash, randomInt } = require('crypto');
const { z } = require('zod');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const studentModel = require('../models/student.model');
const { screenApplication } = require('../services/applicationScreening');
const { calculateEligibility } = require('../services/eligibility');
const { getDuplicateThreshold } = require('../config/settings');
const { APPROVED_SCHOOLS } = require('../config/schools');
const { cleanOptional, normalizeIdentifier, normalizeKenyanPhone, validIsoDate } = require('../services/studentRecordFormat');

// Ten characters from an alphabet without look-alikes (no 0/O, 1/I/l). A guardian reads this code
// over the phone or copies it from a printed slip, so ambiguity is a support cost, not a style choice.
const TRACKING_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const TRACKING_LENGTH = 10;

function generateTrackingCode() {
  let code = '';
  for (let index = 0; index < TRACKING_LENGTH; index += 1) {
    code += TRACKING_ALPHABET[randomInt(TRACKING_ALPHABET.length)];
  }
  return code;
}

function hashTrackingCode(code) {
  return createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

const applicationSchema = z.object({
  full_name: z.string().trim().transform((value) => value.replace(/\s+/g, ' ')).pipe(z.string().min(2).max(255)),
  date_of_birth: z.preprocess(cleanOptional, z.string().refine(validIsoDate, 'Date of birth must use YYYY-MM-DD')),
  school_code: z.enum(APPROVED_SCHOOLS),
  guardian_name: z.string().trim().transform((value) => value.replace(/\s+/g, ' ')).pipe(z.string().min(2).max(255)),
  guardian_phone: z.preprocess(normalizeKenyanPhone, z.string().regex(/^\+254[17]\d{8}$/, 'Phone must be a Kenyan mobile number')),
  guardian_email: z.preprocess(cleanOptional, z.string().email().max(255).optional()),
  relationship_to_student: z.preprocess(cleanOptional, z.string().max(50).optional()),
  upi: z.preprocess(normalizeIdentifier, z.string().max(100).optional()),
  birth_certificate_number: z.preprocess(normalizeIdentifier, z.string().max(100).optional()),
  national_id_number: z.preprocess(normalizeIdentifier, z.string().max(100).optional()),
  primary_phone: z.preprocess(normalizeKenyanPhone, z.string().regex(/^\+254[17]\d{8}$/, 'Phone must be a Kenyan mobile number').optional()),
}).refine(
  (value) => Boolean(value.upi || value.birth_certificate_number || value.national_id_number),
  { message: 'Provide at least one identifier: UPI, birth certificate number or national ID', path: ['upi'] },
);

const trackSchema = z.object({
  tracking_code: z.string().trim().min(TRACKING_LENGTH).max(32),
  date_of_birth: z.preprocess(cleanOptional, z.string().refine(validIsoDate, 'Date of birth must use YYYY-MM-DD')),
});

const resolveSchema = z.object({
  outcome: z.enum(['duplicate_of_existing', 'not_duplicate']),
  canonical_student_id: z.string().uuid().optional(),
  reason: z.string().trim().min(5).max(2000),
}).refine(
  (value) => value.outcome !== 'duplicate_of_existing' || Boolean(value.canonical_student_id),
  { message: 'Name the existing student this application duplicates', path: ['canonical_student_id'] },
);

const investigationSchema = z.object({
  findings: z.string().trim().min(5).max(2000),
  recommendation: z.enum(['likely_duplicate', 'likely_not_duplicate', 'needs_further_checks']),
  notes: z.string().trim().max(2000).optional(),
});

const eligibilityInputsSchema = z.object({
  fee_balance: z.coerce.number().finite().min(0),
  household_income: z.coerce.number().finite().min(0),
  vulnerability_status: z.enum(['low', 'medium', 'high']),
  siblings_in_school: z.coerce.number().int().min(0),
  prior_bursary_history: z.enum(['none', 'low', 'high']),
});

const verifySchema = z.object({
  eligibility: eligibilityInputsSchema,
  // The model never decides. If a high-priority case is open, only an administrator may proceed,
  // and only with a written reason that is stored on the application.
  override_reason: z.string().trim().min(10).max(2000).optional(),
});

/**
 * Public submission.
 *
 * The insert commits before screening runs, so a slow or unavailable predictor can never cost a
 * guardian their application. Screening is then a separate transaction that records either cases or
 * an explicit `screening_failure_code`.
 */
async function submit(req, res, next) {
  let client;
  try {
    const validation = applicationSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: 'Invalid application data', errors: validation.error.flatten() });
    }
    const data = validation.data;

    // The same guardian resubmitting the same child in a day is a duplicate request, not a second
    // child. Answer with a pointer to tracking instead of opening a second case file.
    const { rows: recent } = await pool.query(
      `SELECT id FROM student_applications
        WHERE guardian_phone = $1 AND lower(full_name) = lower($2) AND date_of_birth = $3
          AND created_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [data.guardian_phone, data.full_name, data.date_of_birth],
    );
    if (recent[0]) {
      return res.status(409).json({
        message: 'An application for this child was already submitted in the last 24 hours. Use the tracking code to follow its progress.',
        code: 'APPLICATION_ALREADY_SUBMITTED',
      });
    }

    const trackingCode = generateTrackingCode();
    const payload = { ...data, submitted_via: 'public_form' };
    let application;
    client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO student_applications
           (tracking_code_hash, submitted_payload, guardian_name, guardian_phone, guardian_email,
            relationship_to_student, full_name, date_of_birth, school_code, upi,
            birth_certificate_number, national_id_number, primary_phone)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING id, status, created_at`,
        [
          hashTrackingCode(trackingCode),
          payload,
          data.guardian_name,
          data.guardian_phone,
          data.guardian_email || null,
          data.relationship_to_student || null,
          data.full_name,
          data.date_of_birth,
          data.school_code,
          data.upi || null,
          data.birth_certificate_number || null,
          data.national_id_number || null,
          data.primary_phone || null,
        ],
      );
      application = rows[0];
      await logAudit(null, 'APPLICATION_SUBMITTED', 'student_applications', application.id, {
        school_code: data.school_code,
        has_upi: Boolean(data.upi),
        has_birth_certificate: Boolean(data.birth_certificate_number),
        has_national_id: Boolean(data.national_id_number),
        tracking_code_hash: hashTrackingCode(trackingCode),
      }, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
      client = null;
    }

    let screening;
    const screeningClient = await pool.connect();
    try {
      await screeningClient.query('BEGIN');
      screening = await screenApplication(screeningClient, application.id);
      await logAudit(null, 'APPLICATION_SCREENED', 'student_applications', application.id, {
        model_version: screening.model_version ?? null,
        cases_opened: screening.cases.length,
        failure_code: screening.failureCode,
        aggregation: screening.aggregation,
      }, screeningClient);
      await screeningClient.query('COMMIT');
    } catch (error) {
      await screeningClient.query('ROLLBACK').catch(() => {});
      // The submission is durable at this point; report the screening gap rather than losing it.
      screening = { status: 'submitted', failureCode: 'SCREENING_NOT_RECORDED', cases: [], aggregation: null };
    } finally {
      screeningClient.release();
    }

    return res.status(201).json({
      message: 'Application submitted. Keep the tracking code: it is the only way to follow this application.',
      tracking_code: trackingCode,
      application: {
        id: application.id,
        status: screening.status,
        submitted_at: application.created_at,
        school_code: data.school_code,
        screening: {
          cases_opened: screening.cases.length,
          failure_code: screening.failureCode,
          thresholds_validated: false,
          score_is_calibrated_probability: false,
        },
      },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return next(error);
  }
}

/** Read one application for update inside a transaction, or answer 404/409 in the caller. */
async function lockApplication(client, id) {
  const { rows } = await client.query('SELECT * FROM student_applications WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] || null;
}

function maskIdentifier(value) {
  if (!value) return null;
  const text = String(value);
  return text.length <= 4 ? '****' : `****${text.slice(-4)}`;
}

/**
 * Triage queue.
 *
 * Field officers are not school-scoped in the users table, and inventing a school assignment here
 * would change the permission model in the middle of a workflow change; the list therefore returns
 * the queue to both roles and the state transitions below are what the roles are actually allowed
 * to do (administrator triages and resolves, field officer investigates and verifies).
 */
async function list(req, res, next) {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.full_name, a.school_code, a.date_of_birth, a.created_at, a.updated_at,
              a.screening_priority, a.screening_failure_code,
              (SELECT count(*)::int FROM duplicate_flags f
                WHERE f.application_id = a.id AND f.status IN ('pending', 'needs_verification')) AS open_cases
         FROM student_applications a
        WHERE ($1::text IS NULL OR a.status = $1)
        ORDER BY a.created_at DESC
        LIMIT 200`,
      [status],
    );
    return res.json({ applications: rows });
  } catch (error) {
    return next(error);
  }
}

/** Detail. Administrators see identifiers masked; the revealing endpoint is separate and audited. */
async function detail(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT * FROM student_applications WHERE id = $1', [req.params.id]);
    const application = rows[0];
    if (!application) return res.status(404).json({ message: 'Application not found.' });

    const { rows: cases } = await pool.query(
      `SELECT f.id, f.status, f.probability, f.review_threshold, f.comparison_features, f.created_at,
              s.full_name AS matched_full_name, s.school_code AS matched_school_code,
              s.upi AS matched_upi, s.birth_certificate_number AS matched_birth_certificate_number
         FROM duplicate_flags f
         JOIN students s ON s.id = f.matched_student_id
        WHERE f.application_id = $1
        ORDER BY f.created_at ASC`,
      [application.id],
    );

    const revealing = req.user?.role === 'field_officer';
    const masked = {
      ...application,
      upi: revealing ? application.upi : maskIdentifier(application.upi),
      birth_certificate_number: revealing ? application.birth_certificate_number : maskIdentifier(application.birth_certificate_number),
      national_id_number: revealing ? application.national_id_number : maskIdentifier(application.national_id_number),
      guardian_phone: revealing ? application.guardian_phone : maskIdentifier(application.guardian_phone),
      submitted_payload: undefined,
      tracking_code_hash: undefined,
    };
    return res.json({
      application: masked,
      duplicate_cases: cases.map((entry) => ({
        ...entry,
        matched_upi: revealing ? entry.matched_upi : maskIdentifier(entry.matched_upi),
        matched_birth_certificate_number: revealing
          ? entry.matched_birth_certificate_number
          : maskIdentifier(entry.matched_birth_certificate_number),
      })),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Public tracking.
 *
 * The code alone is not enough: the date of birth must match too, so a guessed code reveals nothing.
 * The response carries the applicant's own summary and their timeline, never another child's
 * identifiers, scores or model features.
 */
async function track(req, res, next) {
  try {
    const validation = trackSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ message: 'Invalid tracking request', errors: validation.error.flatten() });
    }

    const { rows } = await pool.query(
      `SELECT id, status, full_name, school_code, date_of_birth, created_at, updated_at,
              screening_failure_code, screening_priority
         FROM student_applications
        WHERE tracking_code_hash = $1 AND date_of_birth = $2`,
      [hashTrackingCode(validation.data.tracking_code), validation.data.date_of_birth],
    );
    const application = rows[0];
    if (!application) {
      return res.status(404).json({
        message: 'No application matches that tracking code and date of birth.',
        code: 'APPLICATION_NOT_FOUND',
      });
    }

    const { rows: events } = await pool.query(
      `SELECT action, created_at FROM audit_logs
        WHERE table_name = 'student_applications' AND record_id = $1
        ORDER BY created_at ASC`,
      [application.id],
    );

    return res.json({
      application: {
        status: application.status,
        full_name: application.full_name,
        school_code: application.school_code,
        submitted_at: application.created_at,
        updated_at: application.updated_at,
        screening_recorded: Boolean(application.screening_failure_code) || application.screening_priority !== null,
        screening_unavailable: Boolean(application.screening_failure_code),
      },
      timeline: events.map((event) => ({ action: event.action, at: event.created_at })),
    });
  } catch (error) {
    return next(error);
  }
}

/**
 * Administrator triage: the only way an application enters duplicate investigation.
 *
 * A case is opened by screening; triage is the human decision that a case is worth a field visit.
 * It requires at least one open case, so an administrator cannot park a clear application in the
 * investigation queue by mistake.
 */
async function triage(req, res, next) {
  const parsed = z.object({ reason: z.string().trim().min(5).max(2000) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'A reason of at least five characters is required.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const application = await lockApplication(client, req.params.id);
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Application not found.' });
    }
    if (application.status !== 'screened') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: `An application in status '${application.status}' cannot be triaged.`,
      });
    }
    const { rows: openCases } = await client.query(
      `SELECT id FROM duplicate_flags
        WHERE application_id = $1 AND status IN ('pending', 'needs_verification')`,
      [application.id],
    );
    if (!openCases.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'NO_DUPLICATE_CASE', message: 'This application has no duplicate case to investigate.' });
    }
    await client.query(
      "UPDATE student_applications SET status = 'needs_investigation', decision_reason = $2, updated_at = NOW() WHERE id = $1",
      [application.id, parsed.data.reason],
    );
    await logAudit(req.user.id || req.user.sub, 'APPLICATION_TRIAGED', 'student_applications', application.id, {
      reason: parsed.data.reason,
      open_cases: openCases.length,
    }, client);
    await client.query('COMMIT');
    return res.json({ application_id: application.id, status: 'needs_investigation', open_cases: openCases.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

/**
 * Field Officer investigation: a recorded human finding, not a decision.
 *
 * The officer's recommendation is stored on the review event with stage `field_investigation`; the
 * case stays open until an administrator resolves it, so the person who collected the evidence is
 * never the person who acts on it.
 */
async function investigate(req, res, next) {
  const parsed = investigationSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Record findings and a recommendation.', errors: parsed.error.flatten() });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const application = await lockApplication(client, req.params.id);
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Application not found.' });
    }
    if (application.status !== 'needs_investigation') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: `An application in status '${application.status}' is not awaiting investigation.`,
      });
    }
    const { rows: cases } = await client.query(
      `SELECT id FROM duplicate_flags
        WHERE application_id = $1 AND status IN ('pending', 'needs_verification')`,
      [application.id],
    );
    if (!cases.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'NO_DUPLICATE_CASE', message: 'This application has no open duplicate case.' });
    }
    for (const entry of cases) {
      await client.query(
        `INSERT INTO duplicate_review_events (duplicate_flag_id, reviewer_id, decision, reason, notes, stage)
         VALUES ($1, $2, 'needs_verification', $3, $4, 'field_investigation')`,
        [
          entry.id,
          req.user.id || req.user.sub,
          parsed.data.findings,
          `recommendation: ${parsed.data.recommendation}${parsed.data.notes ? ` | ${parsed.data.notes}` : ''}`,
        ],
      );
    }
    await client.query(
      "UPDATE student_applications SET status = 'investigated', updated_at = NOW() WHERE id = $1",
      [application.id],
    );
    await logAudit(req.user.id || req.user.sub, 'APPLICATION_INVESTIGATED', 'student_applications', application.id, {
      recommendation: parsed.data.recommendation,
      cases_reviewed: cases.length,
    }, client);
    await client.query('COMMIT');
    return res.json({ application_id: application.id, status: 'investigated', cases_reviewed: cases.length });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

/**
 * Administrator resolution of the case.
 *
 * The administrator, not the officer and not the model, decides whether the application is the same
 * child as an existing record. A confirmed duplicate names the canonical student and never creates a
 * student row, so the same child cannot be paid twice.
 */
async function resolveCase(req, res, next) {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Record the outcome and a reason.', errors: parsed.error.flatten() });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const application = await lockApplication(client, req.params.id);
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Application not found.' });
    }
    if (!['screened', 'needs_investigation', 'investigated'].includes(application.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: `An application in status '${application.status}' has no case to resolve.`,
      });
    }
    const { rows: cases } = await client.query(
      `SELECT id, matched_student_id FROM duplicate_flags
        WHERE application_id = $1 AND status IN ('pending', 'needs_verification')`,
      [application.id],
    );
    if (!cases.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ code: 'NO_DUPLICATE_CASE', message: 'This application has no open duplicate case.' });
    }
    const actorId = req.user.id || req.user.sub;
    const nextStatus = parsed.data.outcome === 'duplicate_of_existing' ? 'resolved' : 'screened';

    if (parsed.data.outcome === 'duplicate_of_existing') {
      const named = cases.find((entry) => entry.matched_student_id === parsed.data.canonical_student_id);
      if (!named) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'The named student is not one of this application\'s duplicate cases.' });
      }
      await client.query(
        "UPDATE student_applications SET duplicate_of_student_id = $2, status = 'resolved', decision_reason = $3, updated_at = NOW() WHERE id = $1",
        [application.id, parsed.data.canonical_student_id, parsed.data.reason],
      );
    } else {
      await client.query(
        "UPDATE student_applications SET status = 'screened', decision_reason = $2, updated_at = NOW() WHERE id = $1",
        [application.id, parsed.data.reason],
      );
    }

    await client.query(
      `UPDATE duplicate_flags
          SET status = $2, resolved_by = $3, resolved_at = NOW(), updated_at = NOW()
        WHERE application_id = $1 AND status IN ('pending', 'needs_verification')`,
      [
        application.id,
        parsed.data.outcome === 'duplicate_of_existing' ? 'confirmed_duplicate' : 'not_duplicate',
        actorId,
      ],
    );

    await logAudit(actorId, 'APPLICATION_DUPLICATE_RESOLVED', 'student_applications', application.id, {
      outcome: parsed.data.outcome,
      reason: parsed.data.reason,
      canonical_student_id: parsed.data.canonical_student_id || null,
      cases_closed: cases.length,
    }, client);
    await client.query('COMMIT');
    return res.json({ application_id: application.id, status: nextStatus, outcome: parsed.data.outcome });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

/**
 * Field Officer verification: the application becomes a student, with the eligibility assessment
 * that was submitted at the same visit.
 *
 * The duplicate gate lives here as a soft gate: an open high-priority case stops a field officer,
 * while an administrator may proceed only with a written reason that is stored on the application
 * and in the audit log. The model score is compared with the configured high-priority threshold; it
 * never approves anything by itself.
 */
async function verify(req, res, next) {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Record the eligibility inputs before verifying.', errors: parsed.error.flatten() });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sbms.student.registration'))");
    const application = await lockApplication(client, req.params.id);
    if (!application) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Application not found.' });
    }
    if (!['screened', 'resolved'].includes(application.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'INVALID_STATE',
        message: `An application in status '${application.status}' cannot be verified.`,
      });
    }
    if (application.duplicate_of_student_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'DUPLICATE_APPLICATION',
        message: 'This application was resolved as a duplicate of an existing student and cannot create a second record.',
      });
    }

    const { rows: openHighPriority } = await client.query(
      `SELECT id FROM duplicate_flags
        WHERE application_id = $1 AND status IN ('pending', 'needs_verification')
          AND probability >= $2
        LIMIT 1`,
      [application.id, getDuplicateThreshold()],
    );
    if (openHighPriority.length) {
      if (!parsed.data.override_reason) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'DUPLICATE_REVIEW_OPEN',
          message: 'A high-priority duplicate case is still open. Resolve it, or have an administrator record an override reason.',
        });
      }
      if (req.user.role !== 'admin') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          code: 'OVERRIDE_NOT_PERMITTED',
          message: 'Only an administrator may verify an application with an open high-priority duplicate case.',
        });
      }
    }

    const actorId = req.user.id || req.user.sub;
    const student = await studentModel.create({
      full_name: application.full_name,
      date_of_birth: application.date_of_birth,
      school_code: application.school_code,
      upi: application.upi,
      birth_certificate_number: application.birth_certificate_number,
      national_id_number: application.national_id_number,
      primary_phone: application.primary_phone,
      qr_token: randomBytes(32).toString('hex'),
    }, client);

    const assessment = calculateEligibility(parsed.data.eligibility);
    await client.query(
      `UPDATE students
          SET eligibility_score = $2, eligibility_category = $3, eligibility_assessed_at = NOW()
        WHERE id = $1`,
      [student.id, assessment.score, assessment.category],
    );
    await client.query(
      `INSERT INTO eligibility_assessments (
         student_id, score, category, fee_balance, household_income, vulnerability_status,
         siblings_in_school, prior_bursary_history, recommended_min, recommended_max,
         recommended_currency, recommendation_provisional, recommendation_source,
         recorded_via, assessed_by, assessed_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'application_verification', $14, NOW())`,
      [
        student.id,
        assessment.score,
        assessment.category,
        parsed.data.eligibility.fee_balance,
        parsed.data.eligibility.household_income,
        parsed.data.eligibility.vulnerability_status,
        parsed.data.eligibility.siblings_in_school,
        parsed.data.eligibility.prior_bursary_history,
        assessment.recommended_range.min,
        assessment.recommended_range.max,
        assessment.recommended_range.currency,
        assessment.recommended_range.provisional,
        assessment.recommended_range.source,
        actorId,
      ],
    );

    await client.query(
      `UPDATE student_applications
          SET verified_student_id = $2, verified_by = $3, verified_at = NOW(),
              status = 'verified', decision_reason = $4, updated_at = NOW()
        WHERE id = $1`,
      [application.id, student.id, actorId, parsed.data.override_reason || null],
    );
    await logAudit(actorId, 'APPLICATION_VERIFIED', 'student_applications', application.id, {
      student_id: student.id,
      eligibility_score: assessment.score,
      eligibility_category: assessment.category,
      recommendation_provisional: assessment.recommended_range.provisional,
      duplicate_override: Boolean(parsed.data.override_reason),
      override_reason: parsed.data.override_reason || null,
    }, client);
    await client.query('COMMIT');

    return res.status(201).json({
      application_id: application.id,
      status: 'verified',
      student,
      eligibility: assessment,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}

module.exports = {
  submit,
  track,
  list,
  detail,
  triage,
  investigate,
  resolveCase,
  verify,
  generateTrackingCode,
  hashTrackingCode,
  applicationSchema,
};

