const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const {
  buildDuplicateFeatures,
  MIN_NAME_SIMILARITY,
} = require('../services/duplicateCheck');
const { getReviewThreshold } = require('../config/settings');
const { scorePairs, exactNationalIdMatch, exactReviewIdentifierMatches, configuredThreshold } = require('../services/mlDuplicateReview');
const { z } = require('zod');
const { APPROVED_SCHOOLS } = require('../config/schools');

const decisionSchema = z.object({
  decision: z.enum(['confirmed_duplicate', 'not_duplicate', 'needs_verification']),
  reason: z.string().trim().min(5).max(1000),
  notes: z.string().trim().max(4000).optional().default(''),
});

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fieldEvidence(first, second, feature, similarity = 0) {
  if (!first || !second) return 'unavailable';
  if (feature === 'name') {
    return similarity >= MIN_NAME_SIMILARITY ? `high similarity (${Math.round(similarity * 100)}%)` : 'differs';
  }
  if (['school', 'guardian'].includes(feature) && similarity >= MIN_NAME_SIMILARITY && similarity < 1) {
    return `similar (${Math.round(similarity * 100)}%)`;
  }
  const left = normalized(first);
  const right = normalized(second);
  if (!left || !right) return 'unavailable';
  return left === right ? 'matches' : 'differs';
}

function maskIdentifier(value) {
  const text = String(value || '');
  if (!text) return null;
  const visible = text.slice(-3);
  return `${'•'.repeat(Math.max(4, text.length - visible.length))}${visible}`;
}

function toReviewCase(row) {
  const first = {
    full_name: row.student_name,
    date_of_birth: row.student_date_of_birth,
    school_code: row.student_school,
    guardian_id: row.student_guardian_id,
    upi: row.student_upi,
    birth_certificate_number: row.student_birth_certificate_number,
    national_id_number: row.student_national_id_number,
    is_synthetic: row.student_is_synthetic,
  };
  const second = {
    full_name: row.matched_student_name,
    date_of_birth: row.matched_date_of_birth,
    school_code: row.matched_school,
    guardian_id: row.matched_guardian_id,
    upi: row.matched_upi,
    birth_certificate_number: row.matched_birth_certificate_number,
    national_id_number: row.matched_national_id_number,
    is_synthetic: row.matched_student_is_synthetic,
  };
  const legacyFeatures = buildDuplicateFeatures(first, second);
  const modelFeatures = row.comparison_features || null;
  const score = Number(row.probability);
  const threshold = row.review_threshold == null ? getReviewThreshold() : Number(row.review_threshold);
  const exactNationalId = exactNationalIdMatch(first, second);
  const exactUpi = legacyFeatures.upi_match === 1;
  const exactCertificate = legacyFeatures.birth_certificate_match === 1;
  const priority = exactNationalId || exactUpi || exactCertificate || score >= threshold ? 'high' : 'standard';
  const exactIdentifiers = [
    exactUpi && 'UPI',
    exactCertificate && 'birth certificate number',
    exactNationalId && 'National ID',
  ].filter(Boolean);
  const features = modelFeatures || legacyFeatures;
  const reason = exactIdentifiers.length
    ? `Exact ${exactIdentifiers.join(' and ')} match; verify the source documents.`
    : row.model_version
      ? `Model score met the provisional human-review threshold (${threshold.toFixed(2)}).`
      : 'Legacy rule-based flag retained for human review.';

  return {
    id: row.id,
    model_score: row.model_version ? score : null,
    legacy_rule_score: row.model_version ? null : score,
    score_type: row.model_version ? 'unvalidated_model_score' : 'legacy_rule_score',
    model_version: row.model_version || null,
    review_threshold: threshold,
    priority: priority || 'standard',
    status: row.status === 'cleared' ? 'not_duplicate' : row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    reason,
    exact_identifier_matches: exactIdentifiers,
    students: [
      { reference: row.student_id, full_name: first.full_name, is_synthetic: first.is_synthetic, date_of_birth: first.date_of_birth, school: first.school_code, school_code: first.school_code, guardian_id: maskIdentifier(first.guardian_id), upi: maskIdentifier(first.upi), birth_certificate_number: maskIdentifier(first.birth_certificate_number), national_id_number: maskIdentifier(first.national_id_number) },
      { reference: row.matched_student_id, full_name: second.full_name, is_synthetic: second.is_synthetic, date_of_birth: second.date_of_birth, school: second.school_code, school_code: second.school_code, guardian_id: maskIdentifier(second.guardian_id), upi: maskIdentifier(second.upi), birth_certificate_number: maskIdentifier(second.birth_certificate_number), national_id_number: maskIdentifier(second.national_id_number) },
    ],
    evidence: {
      name: fieldEvidence(first.full_name, second.full_name, 'name', features.jaro_winkler || 0),
      date_of_birth: features.dob_match >= 1 ? 'matches' : features.dob_match > 0 ? `similar (${Math.round(features.dob_match * 100)}%)` : fieldEvidence(first.date_of_birth, second.date_of_birth),
      school: fieldEvidence(first.school_code, second.school_code, 'school', features.school_match || 0),
      guardian: fieldEvidence(first.guardian_id, second.guardian_id, 'guardian', features.guardian_match || 0),
      upi: features.upi_match > 0 ? `similar (${Math.round(features.upi_match * 100)}%)` : fieldEvidence(first.upi, second.upi),
      birth_certificate: features.birth_certificate_match > 0 ? `similar (${Math.round(features.birth_certificate_match * 100)}%)` : fieldEvidence(first.birth_certificate_number, second.birth_certificate_number),
      national_id: fieldEvidence(first.national_id_number, second.national_id_number),
    },
    model_features: modelFeatures,
  };
}

const evaluationStudentSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  date_of_birth: z.string().optional(),
  school_code: z.string().optional(),
  guardian_id: z.string().optional(),
  upi: z.string().min(1).max(100),
  birth_certificate_number: z.string().optional(),
  national_id_number: z.string().optional(),
});

const evaluationRequestSchema = z.object({
  pairs: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    first: evaluationStudentSchema,
    second: evaluationStudentSchema,
  })).min(1).max(30),
});

async function evaluate(req, res) {
  const validation = evaluationRequestSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ message: 'Provide between 1 and 30 valid student pairs to evaluate.' });
  }

  try {
    const threshold = configuredThreshold();
    const prediction = await scorePairs(validation.data.pairs.map(({ first, second }) => ({ first, second })));
    const results = validation.data.pairs.map(({ label, first, second }, index) => ({
      label,
      first,
      second,
      model_score: prediction.results[index].score,
      model_features: prediction.results[index].features,
      model_version: prediction.model_version,
      review_threshold: threshold,
      requires_human_review: prediction.results[index].score >= threshold || exactReviewIdentifierMatches(first, second).length > 0,
      score_is_calibrated_probability: false,
    }));
    return res.json({ results, model_version: prediction.model_version, review_threshold: threshold });
  } catch (error) {
    return res.status(503).json({ message: 'Duplicate prediction is unavailable; no result was produced.', code: 'DUPLICATE_SCREENING_UNAVAILABLE' });
  }
}

async function scanExisting(req, res, next) {
  try {
    const { rows: students } = await pool.query(
      `SELECT id, full_name, date_of_birth, school_code, guardian_id, upi,
              birth_certificate_number, national_id_number
       FROM students
       ORDER BY created_at ASC, id ASC`
    );
    const { rows: existingFlags } = await pool.query(
      'SELECT student_id, matched_student_id FROM duplicate_flags'
    );
    const pairKey = (firstId, secondId) => [String(firstId), String(secondId)].sort().join(':');
    const knownPairs = new Set(existingFlags.map((flag) => pairKey(flag.student_id, flag.matched_student_id)));
    const reviewThreshold = configuredThreshold();
    const candidates = [];
    let pairsCompared = 0;
    let existingPairsSkipped = 0;
    let modelVersion = (await scorePairs([])).model_version;
    let flagsCreated = 0;
    let candidatesScored = 0;
    let candidatesFound = 0;
    const flushCandidates = async () => {
      if (!candidates.length) return;
      const batch = candidates.splice(0, candidates.length);
      const prediction = await scorePairs(batch.map(({ first, second }) => ({ first, second })));
      if (prediction.model_version !== modelVersion) throw new Error('Python duplicate model changed during the scan');
      candidatesScored += batch.length;
      const matches = batch.flatMap(({ first, second }, index) => {
        const result = prediction.results[index];
        return result.score >= reviewThreshold || exactReviewIdentifierMatches(first, second).length > 0
          ? [{ first, second, score: result.score, features: result.features }]
          : [];
      });
      candidatesFound += matches.length;
      if (!matches.length) return;
      const parameters = [];
      const values = matches.map((match, index) => {
        const position = index * 6;
        parameters.push(match.second.id, match.first.id, match.score, modelVersion, reviewThreshold, match.features);
        return `($${position + 1}, $${position + 2}, $${position + 3}, 'pending', $${position + 4}, $${position + 5}, $${position + 6})`;
      });
      const inserted = await pool.query(
        `INSERT INTO duplicate_flags
           (student_id, matched_student_id, probability, status, model_version, review_threshold, comparison_features)
         VALUES ${values.join(', ')} ON CONFLICT DO NOTHING RETURNING id`,
        parameters
      );
      flagsCreated += inserted.rowCount;
    };

    for (let firstIndex = 0; firstIndex < students.length; firstIndex += 1) {
      const first = students[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < students.length; secondIndex += 1) {
        const second = students[secondIndex];
        pairsCompared += 1;
        const key = pairKey(first.id, second.id);
        if (knownPairs.has(key)) {
          existingPairsSkipped += 1;
          continue;
        }
        knownPairs.add(key);
        candidates.push({ first, second });
        if (candidates.length >= 200) await flushCandidates();
      }
    }
    await flushCandidates();

    await logAudit(req.user.id || req.user.sub, 'SCAN_DUPLICATES', 'students', null, {
      model_version: modelVersion,
      review_threshold: reviewThreshold,
      candidates_scored: candidatesScored,
      flags_created: flagsCreated,
    });
    res.json({
      records_scanned: students.length,
      pairs_compared: pairsCompared,
      candidates_found: candidatesFound,
      flags_created: flagsCreated,
      existing_pairs_skipped: existingPairsSkipped,
      model_version: modelVersion,
      review_threshold: reviewThreshold,
      score_is_calibrated_probability: false,
    });
  } catch (error) {
    if (error.code === 'DUPLICATE_PREDICTOR_FAILED') {
      return res.status(503).json({
        message: 'Duplicate scan is incomplete because the prediction service failed. Rerun the scan to continue; already created pair cases are skipped safely.',
        code: 'DUPLICATE_SCREENING_UNAVAILABLE',
      });
    }
    next(error);
  }
}

async function list(req, res, next) {
  try {
    const statuses = ['pending', 'needs_verification', 'confirmed_duplicate', 'not_duplicate', 'all'];
    const status = statuses.includes(req.query.status) ? req.query.status : 'open';
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(req.query.page_size, 10) || 20));
    const priorityFilter = ['high', 'standard'].includes(req.query.priority) ? req.query.priority : 'all';
    const search = String(req.query.search || '').trim().toLowerCase();
    const schoolFilter = String(req.query.school || '').trim().toLowerCase();
    const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const toDate = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    const result = await pool.query(
      `SELECT df.id, df.probability, df.status, df.created_at,
              df.updated_at, df.model_version, df.review_threshold, df.comparison_features,
              s1.id AS student_id, s2.id AS matched_student_id,
              s1.is_synthetic AS student_is_synthetic, s2.is_synthetic AS matched_student_is_synthetic,
              s1.full_name AS student_name, s1.school_code AS student_school,
              TO_CHAR(s1.date_of_birth, 'YYYY-MM-DD') AS student_date_of_birth,
              s1.guardian_id AS student_guardian_id,
              s1.upi AS student_upi,
              s1.birth_certificate_number AS student_birth_certificate_number,
              s1.national_id_number AS student_national_id_number,
              s2.full_name AS matched_student_name, s2.school_code AS matched_school,
              TO_CHAR(s2.date_of_birth, 'YYYY-MM-DD') AS matched_date_of_birth,
              s2.guardian_id AS matched_guardian_id,
              s2.upi AS matched_upi,
              s2.birth_certificate_number AS matched_birth_certificate_number,
              s2.national_id_number AS matched_national_id_number,
              s1.date_of_birth IS NOT DISTINCT FROM s2.date_of_birth AS date_of_birth_match,
              s1.school_code IS NOT DISTINCT FROM s2.school_code AS school_match,
              s1.guardian_id IS NOT DISTINCT FROM s2.guardian_id AS guardian_match,
              s1.upi IS NOT DISTINCT FROM s2.upi AS upi_match
       FROM duplicate_flags df
       JOIN students s1 ON df.student_id = s1.id
       JOIN students s2 ON df.matched_student_id = s2.id
       WHERE ($1 = 'all' OR ($1 = 'open' AND df.status IN ('pending', 'needs_verification'))
              OR ($1 = 'not_duplicate' AND df.status IN ('not_duplicate', 'cleared'))
              OR ($1 NOT IN ('all', 'open', 'not_duplicate') AND df.status = $1))
       ORDER BY df.created_at DESC`,
      [status]
    );
    const cases = result.rows.map(toReviewCase);
    const openCases = cases.filter((reviewCase) => ['pending', 'needs_verification'].includes(reviewCase.status));
    const pendingCases = cases.filter((reviewCase) => reviewCase.status === 'pending');
    const filtered = cases.filter((reviewCase) => {
      if (priorityFilter !== 'all' && reviewCase.priority !== priorityFilter) return false;
      if (schoolFilter && !reviewCase.students.some((student) => String(student.school || '').toLowerCase() === schoolFilter)) return false;
      if (search && !reviewCase.students.some((student) => student.full_name.toLowerCase().includes(search) || student.reference.toLowerCase().includes(search))) return false;
      const created = String(reviewCase.created_at || '').slice(0, 10);
      if (fromDate && created < fromDate) return false;
      if (toDate && created > toDate) return false;
      return true;
    });
    const pageCases = filtered.slice((page - 1) * pageSize, page * pageSize);
    const ids = pageCases.map((reviewCase) => reviewCase.id);
    const history = ids.length
      ? await pool.query(
        `SELECT e.id, e.duplicate_flag_id, e.decision, e.reason, e.notes, e.created_at, u.full_name AS reviewer_name
         FROM duplicate_review_events e JOIN users u ON u.id = e.reviewer_id
         WHERE e.duplicate_flag_id = ANY($1::uuid[]) ORDER BY e.created_at DESC`,
        [ids]
      )
      : { rows: [] };
    const historyByFlag = new Map();
    for (const event of history.rows) {
      if (!historyByFlag.has(event.duplicate_flag_id)) historyByFlag.set(event.duplicate_flag_id, []);
      historyByFlag.get(event.duplicate_flag_id).push(event);
    }
    for (const reviewCase of pageCases) reviewCase.history = historyByFlag.get(reviewCase.id) || [];

    res.json({
      cases: pageCases,
      summary: {
        high_priority_pending: pendingCases.filter((item) => item.priority === 'high').length,
        standard_review_pending: pendingCases.filter((item) => item.priority === 'standard').length,
        awaiting_verification: openCases.filter((item) => item.status === 'needs_verification').length,
      },
      case_totals: {
        flagged: cases.length,
        confirmed_duplicate: cases.filter((item) => item.status === 'confirmed_duplicate').length,
        not_duplicate: cases.filter((item) => item.status === 'not_duplicate').length,
        unresolved: openCases.length,
      },
      schools: APPROVED_SCHOOLS,
      pagination: { page, page_size: pageSize, total: filtered.length, pages: Math.ceil(filtered.length / pageSize) },
      policy: {
        review_threshold: configuredThreshold(),
        high_priority_threshold: null,
        thresholds_validated: false,
        explanation: 'The model score is an uncalibrated review signal. Thresholds have not been validated on representative reviewed records; no model score makes a final duplicate decision.',
        score_is_calibrated_probability: false,
      },
    });
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  const validation = decisionSchema.safeParse(req.body);
  if (!validation.success) return res.status(400).json({ message: 'Select a decision and provide a reason of at least 5 characters.' });
  const reviewerId = req.user.id || req.user.sub;
  const { decision, reason, notes } = validation.data;
  const statusByDecision = {
    confirmed_duplicate: 'confirmed_duplicate',
    not_duplicate: 'not_duplicate',
    needs_verification: 'needs_verification',
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE duplicate_flags
       SET status = $1, resolved_by = $2, resolved_at = CASE WHEN $3::boolean THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $4 AND status IN ('pending', 'needs_verification') RETURNING *`,
      [statusByDecision[decision], reviewerId, decision !== 'needs_verification', req.params.id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Duplicate flag not found' });
    }

    const flag = result.rows[0];
    await client.query(
      `INSERT INTO duplicate_review_events (duplicate_flag_id, reviewer_id, decision, reason, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [flag.id, reviewerId, decision, reason, notes || null]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
       VALUES ($1, $2, 'duplicate_flags', $3, $4)`,
      [reviewerId, `DUPLICATE_${decision.toUpperCase()}`, flag.id, {
        decision,
        reason,
        notes: notes || null,
        model_version: flag.model_version,
        model_score: flag.probability,
        review_threshold: flag.review_threshold,
      }]
    );
    await client.query('COMMIT');
    res.json({ message: 'Review decision recorded', flag });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { evaluate, list, scanExisting, update };
