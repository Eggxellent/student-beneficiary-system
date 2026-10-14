const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const {
  buildDuplicateFeatures,
  calculateDuplicateContributions,
  calculateDuplicateScore,
  classifyDuplicate,
  duplicateReviewReason,
  DUPLICATE_SCORE_MAXIMUMS,
  hasCorroboratingMajority,
  MIN_NAME_SIMILARITY,
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
  })).min(1).max(30),
});

function evaluate(req, res) {
  const validation = evaluationRequestSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ message: 'Provide between 1 and 30 valid student pairs to evaluate.' });
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

async function scanExisting(req, res, next) {
  try {
    const { rows: students } = await pool.query(
      `SELECT id, full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number
       FROM students
       ORDER BY created_at ASC, id ASC`
    );
    const { rows: existingFlags } = await pool.query(
      'SELECT student_id, matched_student_id FROM duplicate_flags'
    );
    const pairKey = (firstId, secondId) => [String(firstId), String(secondId)].sort().join(':');
    const knownPairs = new Set(existingFlags.map((flag) => pairKey(flag.student_id, flag.matched_student_id)));
    const duplicateThreshold = getDuplicateThreshold();
    const reviewThreshold = getReviewThreshold();
    const pendingFlags = [];
    let pairsCompared = 0;
    let existingPairsSkipped = 0;

    for (let firstIndex = 0; firstIndex < students.length; firstIndex += 1) {
      const first = students[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < students.length; secondIndex += 1) {
        const second = students[secondIndex];
        pairsCompared += 1;
        const features = buildDuplicateFeatures(first, second);
        if (
          features.jaro_winkler < MIN_NAME_SIMILARITY
          && !features.upi_match
          && !features.birth_certificate_match
          && !hasCorroboratingMajority(features)
        ) continue;

        const probability = calculateDuplicateScore(features);
        const riskLevel = classifyDuplicate(features, probability, duplicateThreshold, reviewThreshold);
        if (riskLevel === 'clear') continue;

        const key = pairKey(first.id, second.id);
        if (knownPairs.has(key)) {
          existingPairsSkipped += 1;
          continue;
        }
        knownPairs.add(key);
        pendingFlags.push({ studentId: second.id, matchedStudentId: first.id, probability });
      }
    }

    let flagsCreated = 0;
    for (let offset = 0; offset < pendingFlags.length; offset += 500) {
      const batch = pendingFlags.slice(offset, offset + 500);
      const values = [];
      const parameters = [];
      batch.forEach((flag, index) => {
        const position = index * 3;
        values.push(`($${position + 1}, $${position + 2}, $${position + 3}, 'pending')`);
        parameters.push(flag.studentId, flag.matchedStudentId, flag.probability);
      });
      const inserted = await pool.query(
        `INSERT INTO duplicate_flags (student_id, matched_student_id, probability, status)
         VALUES ${values.join(', ')} RETURNING id`,
        parameters
      );
      flagsCreated += inserted.rowCount;
    }

    await logAudit(req.user.id || req.user.sub, 'SCAN_DUPLICATES', 'students', null);
    res.json({
      records_scanned: students.length,
      pairs_compared: pairsCompared,
      candidates_found: pendingFlags.length + existingPairsSkipped,
      flags_created: flagsCreated,
      existing_pairs_skipped: existingPairsSkipped,
    });
  } catch (error) {
    next(error);
  }
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
      const riskLevel = classifyDuplicate(features, probability, getDuplicateThreshold(), reviewThreshold);
      const shouldAutoClear = status === 'pending' && riskLevel === 'clear';
      if (shouldAutoClear) {
        await pool.query(
          `UPDATE duplicate_flags
           SET probability = $1, status = 'cleared', resolved_by = NULL, resolved_at = NOW()
           WHERE id = $2 AND status = 'pending'`,
          [probability, flag.id]
        );
        await logAudit(null, 'AUTO_CLEAR_LOW_SCORE', 'duplicate_flags', flag.id);
      } else {
        await pool.query('UPDATE duplicate_flags SET probability = $1 WHERE id = $2', [probability, flag.id]);
      }
      return {
        ...flag,
        probability,
        status: shouldAutoClear ? 'cleared' : flag.status,
        risk_level: riskLevel,
        review_reason: duplicateReviewReason(features, probability, reviewThreshold),
        score_breakdown: calculateDuplicateContributions(features),
        score_maximums: DUPLICATE_SCORE_MAXIMUMS,
        calculated_probability: probability,
      };
    }));
    res.json(status === 'pending' ? refreshedFlags.filter((flag) => flag.status === 'pending') : refreshedFlags);
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

module.exports = { evaluate, list, scanExisting, update };
