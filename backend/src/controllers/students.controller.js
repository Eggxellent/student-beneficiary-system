const studentModel = require('../models/student.model');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const {
  buildDuplicateFeatures,
  calculateDuplicateScore,
  checkDuplicates,
  classifyDuplicate,
  duplicateReviewReason,
  hasCorroboratingMajority,
  MIN_NAME_SIMILARITY,
} = require('../services/duplicateCheck');
const { getDuplicateThreshold, getReviewThreshold } = require('../config/settings');
const QRCode = require('qrcode');
const { z } = require('zod');

const studentSchema = z.object({
  full_name: z.string().min(2),
  date_of_birth: z.string().optional(),
  school_code: z.string().optional(),
  guardian_id: z.string().optional(),
  upi: z.string().min(1),
  birth_certificate_number: z.string().optional()
});

function buildModelFeatures(first, second, heuristicFeatures) {
  // Keep the ML feature contract aligned with ml-service/predict.py:
  // name similarity plus exact-match indicators for DOB, school, guardian and IDs.
  return {
    ...heuristicFeatures,
    dob_match: Number(Boolean(first.date_of_birth && second.date_of_birth
      && dateValue(first.date_of_birth) === dateValue(second.date_of_birth))),
    school_match: Number(Boolean(first.school_code && second.school_code
      && String(first.school_code).trim().toLowerCase() === String(second.school_code).trim().toLowerCase())),
    guardian_match: Number(Boolean(first.guardian_id && second.guardian_id
      && String(first.guardian_id).trim().toLowerCase() === String(second.guardian_id).trim().toLowerCase())),
  };
}

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
      birth_certificate_number
    } = validation.data;

    const { rows: exactUpiCandidates } = upi
      ? await pool.query('SELECT * FROM students WHERE upi = $1', [upi])
      : { rows: [] };
    const { rows: exactCertificateCandidates } = birth_certificate_number
      ? await pool.query('SELECT * FROM students WHERE birth_certificate_number = $1', [birth_certificate_number])
      : { rows: [] };
    const exactUpiIds = new Set(exactUpiCandidates.map((candidate) => candidate.id));
    const exactCandidateIds = new Set([
      ...exactUpiIds,
      ...exactCertificateCandidates.map((candidate) => candidate.id),
    ]);
    const { rows: candidates } = await pool.query(
      'SELECT * FROM students WHERE id <> ALL($1::uuid[]) ORDER BY created_at DESC LIMIT 1000',
      [Array.from(exactCandidateIds)]
    );
    const duplicateCandidates = [];
    const candidateById = new Map(
      [...exactUpiCandidates, ...exactCertificateCandidates, ...candidates]
        .map((candidate) => [candidate.id, candidate])
    );
    for (const candidate of candidateById.values()) {
      const birthCertificateMatch = Number(Boolean(
        birth_certificate_number
        && birth_certificate_number === candidate.birth_certificate_number
      ));
      const features = buildDuplicateFeatures(
        { full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number },
        candidate
      );
      if (
        features.jaro_winkler < MIN_NAME_SIMILARITY
        && !features.upi_match
        && !birthCertificateMatch
        && !hasCorroboratingMajority(features)
      ) continue;
      duplicateCandidates.push({
        candidate,
        features,
      });
    }

    let duplicateResults = [];
    if (duplicateCandidates.length > 0) {
      if (process.env.SBMS_DUPLICATE_SCORING === 'model') {
        // Explicit opt-in for model evaluation. Do not enable until a compatible,
        // evaluated model artifact is supplied and tested.
        const predictions = await checkDuplicates(duplicateCandidates.map(({ candidate, features }) =>
          buildModelFeatures({ date_of_birth, school_code, guardian_id }, candidate, features)
        ));
        duplicateResults = duplicateCandidates.map(({ candidate, features }, index) => ({
          candidate,
          features,
          probability: predictions[index].probability,
        }));
      } else {
        duplicateResults = duplicateCandidates.map(({ candidate, features }) => ({
          candidate,
          features,
          probability: calculateDuplicateScore(features),
        }));
      }
    }

    const student = await studentModel.create({ full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number });
    const qrCode = await QRCode.toDataURL(student.id);
    const flags = [];
    const duplicateThreshold = getDuplicateThreshold();
    const reviewThreshold = getReviewThreshold();
    for (const result of duplicateResults) {
      const riskLevel = classifyDuplicate(result.features, result.probability, duplicateThreshold, reviewThreshold);
      if (riskLevel === 'clear') continue;

      const { rows } = await pool.query(
        `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
         VALUES ($1, $2, $3, 'pending') RETURNING *`,
        [student.id, result.candidate.id, result.probability]
      );

      flags.push({
        ...rows[0],
        risk_level: riskLevel,
        review_reason: duplicateReviewReason(result.features, result.probability, reviewThreshold),
      });
    }

    await logAudit(req.user.id || req.user.sub, 'CREATE', 'students', student.id);
    res.status(201).json({
      message: 'Student registered successfully',
      student,
      qr_code: qrCode,
      duplicate_flags: flags,
    });
  } catch (error) {
    next(error);
  }
}

async function list(req, res, next) {
  try { res.json(await studentModel.getAll()); } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    const student = await studentModel.getById(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) { next(error); }
}

module.exports = { create, list, get, buildModelFeatures };
