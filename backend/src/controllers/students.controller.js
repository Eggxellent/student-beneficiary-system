const studentModel = require('../models/student.model');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const { exactReviewIdentifierMatches, scorePairs, configuredThreshold } = require('../services/mlDuplicateReview');
const QRCode = require('qrcode');
const { randomBytes } = require('crypto');
const { buildStudentVerificationUrl } = require('../config/publicAppUrl');
const { z } = require('zod');
const { APPROVED_SCHOOLS } = require('../config/schools');
const { cleanOptional, normalizeIdentifier, normalizeKenyanPhone, validIsoDate } = require('../services/studentRecordFormat');

// QR tokens are intentionally excluded; the server generates the authoritative token.
const studentSchema = z.object({
  full_name: z.string().trim().transform((value) => value.replace(/\s+/g, ' ')).pipe(z.string().min(2).max(255)),
  date_of_birth: z.preprocess(cleanOptional, z.string().refine(validIsoDate, 'Date of birth must use YYYY-MM-DD').optional()),
  school_code: z.enum(APPROVED_SCHOOLS),
  guardian_id: z.preprocess(normalizeIdentifier, z.string().max(100).optional()),
  upi: z.preprocess(normalizeIdentifier, z.string().max(100).optional()),
  birth_certificate_number: z.preprocess(normalizeIdentifier, z.string().max(100).optional()),
  national_id_number: z.preprocess(normalizeIdentifier, z.string().max(100).optional()),
  primary_phone: z.preprocess(normalizeKenyanPhone, z.string().regex(/^\+254[17]\d{8}$/, 'Phone must be a Kenyan mobile number').optional()),
});

function dateValue(value) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().split('T')[0] : String(value).slice(0, 10);
}

async function create(req, res, next) {
  try {
    const validation = studentSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: 'Invalid student data',
        errors: validation.error.flatten()
      });
    }

    const {
      full_name,
      date_of_birth,
      school_code,
      guardian_id,
      upi,
      birth_certificate_number,
      national_id_number,
      primary_phone,
    } = validation.data;

    const submitted = { full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number, national_id_number };
    const threshold = configuredThreshold();
    const token = randomBytes(32).toString('hex');
    const verificationUrl = buildStudentVerificationUrl(token);
    const qrCode = await QRCode.toDataURL(verificationUrl);
    const flags = [];
    const client = await pool.connect();
    let student;
    let prediction;
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtext('sbms.student.registration'))");
      const { rows: candidates } = await client.query(
        `SELECT id, full_name, date_of_birth, school_code, guardian_id, upi,
                birth_certificate_number, national_id_number
         FROM students ORDER BY created_at ASC, id ASC FOR UPDATE`
      );
      try {
        prediction = await scorePairs(candidates.map((candidate) => ({ first: submitted, second: candidate })));
      } catch (error) {
        await client.query('ROLLBACK');
        return res.status(503).json({
          message: 'Student registration was not completed because duplicate screening is unavailable. Please retry or contact support.',
          code: 'DUPLICATE_SCREENING_UNAVAILABLE',
        });
      }
      const duplicateResults = candidates.flatMap((candidate, index) => {
        const result = prediction.results[index];
        const exactIdentifiers = exactReviewIdentifierMatches(submitted, candidate);
        return result.score >= threshold || exactIdentifiers.length > 0
          ? [{ candidate, score: result.score, features: result.features, exactIdentifiers }]
          : [];
      });
      student = await studentModel.create({ full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number, national_id_number, primary_phone, qr_token: token }, client);
      for (const result of duplicateResults) {
        const { rows } = await client.query(
          `INSERT INTO duplicate_flags
             (student_id, matched_student_id, probability, status, model_version, review_threshold, comparison_features)
           VALUES ($1, $2, $3, 'pending', $4, $5, $6)
           ON CONFLICT DO NOTHING RETURNING *`,
          [student.id, result.candidate.id, result.score, prediction.model_version, threshold, result.features]
        );
        if (rows[0]) flags.push({
          ...rows[0],
          model_score: result.score,
          risk_level: 'review',
          review_reason: result.exactIdentifiers.length
            ? `Exact ${result.exactIdentifiers.join(' and ')} match; an administrator must verify the source documents.`
            : `Model score met the provisional human-review cutoff (${threshold.toFixed(2)}).`,
        });
      }
      await logAudit(req.user.id || req.user.sub, 'CREATE', 'students', student.id, {
        duplicate_model_version: prediction.model_version,
        duplicate_review_threshold: threshold,
        duplicate_flags_created: flags.length,
      }, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
    res.status(201).json({
      message: 'Student registered successfully',
      student,
      qr_code: qrCode,
      duplicate_flags: flags,
      duplicate_screening: { model_version: prediction.model_version, review_threshold: threshold, score_is_calibrated_probability: false },
    });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try { res.json(await studentModel.getAll()); } catch (error) { next(error); }
}

async function listSchools(req, res, next) {
  try {
    res.json(APPROVED_SCHOOLS);
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    const student = await studentModel.getById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) { next(error); }
}

module.exports = { create, list, listSchools, get };
