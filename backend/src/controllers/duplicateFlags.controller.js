const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const {
  buildDuplicateFeatures,
  calculateDuplicateContributions,
  calculateDuplicateScore,
  classifyDuplicate,
  duplicateReviewReason,
  DUPLICATE_SCORE_MAXIMUMS,
} = require('../services/duplicateCheck');
const { getDuplicateThreshold, getReviewThreshold } = require('../config/settings');
const { z } = require('zod');

const evaluationStudentSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  date_of_birth: z.string().optional(),
  school_code: z.string().optional(),
  guardian_id: z.string().optional(),
  upi: z.string().min(1).max(100),
  birth_certificate_number: z.string().optional(),
});

const evaluationRequestSchema = z.object({
  pairs: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    first: evaluationStudentSchema,
    second: evaluationStudentSchema,
  })).min(1).max(10),
});

function evaluate(req, res) {
  const validation = evaluationRequestSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ message: 'Provide between 1 and 10 valid student pairs to evaluate.' });
  }

  const results = validation.data.pairs.map(({ label, first, second }) => {
    const features = buildDuplicateFeatures(first, second);
    const probability = calculateDuplicateScore(features);
    const decision = classifyDuplicate(features, probability, getDuplicateThreshold(), getReviewThreshold());

    return {
      label,
      first,
      second,
      probability,
      decision,
      review_reason: duplicateReviewReason(features, probability, getReviewThreshold()),
      score_breakdown: calculateDuplicateContributions(features),
      score_maximums: DUPLICATE_SCORE_MAXIMUMS,
    };
  });

  return res.json({ results });
}

async function list(req, res, next) {
  try {
    const { status = 'pending' } = req.query;
    const result = await pool.query(
      `SELECT df.id, df.probability, df.status, df.created_at,
              s1.full_name AS student_name, s1.school_code AS student_school,
              TO_CHAR(s1.date_of_birth, 'YYYY-MM-DD') AS student_date_of_birth,
              s1.guardian_id AS student_guardian_id,
              s1.upi AS student_upi,
              s1.birth_certificate_number AS student_birth_certificate_number,
              s2.full_name AS matched_student_name, s2.school_code AS matched_school,
              TO_CHAR(s2.date_of_birth, 'YYYY-MM-DD') AS matched_date_of_birth,
              s2.guardian_id AS matched_guardian_id,
              s2.upi AS matched_upi,
              s2.birth_certificate_number AS matched_birth_certificate_number,
              s1.date_of_birth IS NOT DISTINCT FROM s2.date_of_birth AS date_of_birth_match,
              s1.school_code IS NOT DISTINCT FROM s2.school_code AS school_match,
              s1.guardian_id IS NOT DISTINCT FROM s2.guardian_id AS guardian_match,
              s1.upi IS NOT DISTINCT FROM s2.upi AS upi_match
       FROM duplicate_flags df
       JOIN students s1 ON df.student_id = s1.id
       JOIN students s2 ON df.matched_student_id = s2.id
       WHERE df.status = $1
       ORDER BY df.created_at DESC`,
      [status]
    );
    const refreshedFlags = await Promise.all(result.rows.map(async (flag) => {
      const features = buildDuplicateFeatures(
        { full_name: flag.student_name, date_of_birth: flag.student_date_of_birth, school_code: flag.student_school, guardian_id: flag.student_guardian_id, upi: flag.student_upi, birth_certificate_number: flag.student_birth_certificate_number },
        { full_name: flag.matched_student_name, date_of_birth: flag.matched_date_of_birth, school_code: flag.matched_school, guardian_id: flag.matched_guardian_id, upi: flag.matched_upi, birth_certificate_number: flag.matched_birth_certificate_number }
      );
      const probability = calculateDuplicateScore(features);
      const reviewThreshold = getReviewThreshold();
      await pool.query('UPDATE duplicate_flags SET probability = $1 WHERE id = $2', [probability, flag.id]);
      return {
        ...flag,
        probability,
        risk_level: classifyDuplicate(features, probability, getDuplicateThreshold(), reviewThreshold),
        review_reason: duplicateReviewReason(features, probability, reviewThreshold),
        score_breakdown: calculateDuplicateContributions(features),
        score_maximums: DUPLICATE_SCORE_MAXIMUMS,
        calculated_probability: probability,
      };
    }));
    res.json(refreshedFlags);
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const { status } = req.body;
    if (!['confirmed_duplicate', 'cleared'].includes(status)) {
      return res.status(400).json({ message: 'Status must be confirmed_duplicate or cleared' });
    }

    const result = await pool.query(
      `UPDATE duplicate_flags
       SET status = $1, resolved_by = $2, resolved_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, req.user.id || req.user.sub, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Duplicate flag not found' });

    const flag = result.rows[0];
    await logAudit(req.user.id || req.user.sub, 'RESOLVE_DUPLICATE', 'duplicate_flags', flag.id);
    res.json({ message: 'Duplicate flag updated successfully', flag });
  } catch (error) {
    next(error);
  }
}

module.exports = { evaluate, list, update };
