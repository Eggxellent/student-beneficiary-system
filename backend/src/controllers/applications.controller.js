const { randomBytes, createHash, randomInt } = require('crypto');
const { z } = require('zod');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const { screenApplication } = require('../services/applicationScreening');
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

module.exports = { submit, track, generateTrackingCode, hashTrackingCode, applicationSchema };
