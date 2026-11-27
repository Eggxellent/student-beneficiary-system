const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const {
  buildDuplicateFeatures,
  MIN_NAME_SIMILARITY,
} = require('../services/duplicateCheck');
const { getReviewThreshold, getDuplicateThreshold } = require('../config/settings');
const {
  scorePairs,
  exactSchoolCodeMatch,
  exactReviewIdentifierMatches,
  reviewPriority,
  configuredThreshold,
} = require('../services/mlDuplicateReview');
const { z } = require('zod');
const { APPROVED_SCHOOLS } = require('../config/schools');
const { normalizeAggregationPolicy, selectFlaggedCandidates } = require('../services/duplicateAggregation');
const {
  assessAutomatically,
  duplicateBlockReason,
  guardianStudentInCase,
  latestApplicationForStudent,
} = require('../services/automaticAssessment');

const decisionSchema = z.object({
  decision: z.enum(['confirmed_duplicate', 'not_duplicate', 'needs_verification']),
  reason: z.string().trim().min(5).max(1000),
  notes: z.string().trim().max(4000).optional().default(''),
});

// Resolution is separate from the review decision: the administrator names which of the two
// records stays canonical. There is no default, and the reason is mandatory.
const resolutionSchema = z.object({
  canonical_student_id: z.string().uuid(),
  reason: z.string().trim().min(5).max(2000),
});

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fieldEvidence(first, second, feature, similarity = 0) {
  if (!first || !second) return 'unavailable';
  if (feature === 'name') {
    return similarity >= MIN_NAME_SIMILARITY ? `high similarity (${Math.round(similarity * 100)}%)` : 'differs';
  }
  if (feature === 'school' && similarity >= MIN_NAME_SIMILARITY && similarity < 1) {
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

function publicReviewEvidence(evidence, { includeStudentNormalized = false } = {}) {
  if (!evidence || typeof evidence !== 'object') return evidence;
  const comparisons = Object.fromEntries(Object.entries(evidence.comparisons || {}).flatMap(([key, value]) => {
    const { normalized, ...safeValue } = value || {};
    if (key === 'guardian_context') {
      return [[key, {
        national_id_match: safeValue.national_id_match === true,
        match_type: safeValue.match_type || 'unavailable_or_invalid',
        evidence_role: 'guardian_context_only',
      }]];
    }
    if (key.toLowerCase().includes('national_id')) return [];
    return [[key, includeStudentNormalized && normalized !== undefined ? { ...safeValue, normalized } : safeValue]];
  }));
  const safeEvidence = Object.fromEntries(Object.entries(evidence)
    .filter(([key]) => key !== 'comparisons' && !key.toLowerCase().includes('national_id')));
  return { ...safeEvidence, comparisons };
}

const CASE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVEALED_IDENTIFIER_FIELDS = ['guardian_contact', 'admission_number', 'birth_certificate_number', 'guardian_national_id', 'near_match_normalized_values'];

function toReviewCase(row) {
  const first = {
    full_name: row.student_name,
    date_of_birth: row.student_date_of_birth,
    school_code: row.student_school,
    school_name: row.student_school_name,
    guardian_id: row.student_guardian_id,
    primary_phone: row.student_guardian_contact,
    admission_number: row.student_admission_number,
    birth_certificate_number: row.student_birth_certificate_number,
    guardian_national_id: row.student_guardian_national_id,
    is_synthetic: row.student_is_synthetic,
  };
  const second = {
    full_name: row.matched_student_name,
    date_of_birth: row.matched_date_of_birth,
    school_code: row.matched_school,
    school_name: row.matched_school_name,
    guardian_id: row.matched_guardian_id,
    primary_phone: row.matched_guardian_contact,
    admission_number: row.matched_admission_number,
    birth_certificate_number: row.matched_birth_certificate_number,
    guardian_national_id: row.matched_guardian_national_id,
    is_synthetic: row.matched_student_is_synthetic,
  };
  const legacyFeatures = buildDuplicateFeatures(first, second);
  const storedComparison = row.comparison_features || null;
  const reviewEvidence = storedComparison && storedComparison.review_evidence || null;
  const modelFeatures = storedComparison
    ? Object.fromEntries(Object.entries(storedComparison).filter(([key]) => key !== 'review_evidence'))
    : null;
  const score = Number(row.probability);
  const threshold = row.review_threshold == null ? getReviewThreshold() : Number(row.review_threshold);
  // Guardian National ID is contextual household evidence, never student-unique evidence.
  const exactIdentifiers = exactReviewIdentifierMatches(first, second);
  // Shared with the registration response so the queue and the confirmation screen cannot
  // disagree about how serious the same case is. `threshold` above is the review cutoff
  // that created the flag; priority uses the separate high-priority cutoff.
  const priority = reviewPriority({
    score,
    highPriorityThreshold: getDuplicateThreshold(),
    exactIdentifierCount: exactIdentifiers.length,
  });
  const features = modelFeatures || legacyFeatures;
  // A name, a date of birth and a school code are all shared by unrelated beneficiaries, so they
  // cannot separate two people on their own. When both records carry an admission number (within
  // one school) or a birth certificate number and those values differ, the pair is described that
  // way instead of as a model match.
  const bothAdmission = Boolean(
    exactSchoolCodeMatch(first, second)
    && normalized(first.admission_number) && normalized(second.admission_number)
  );
  const bothCertificate = Boolean(normalized(first.birth_certificate_number) && normalized(second.birth_certificate_number));
  const conflictingIdentifiers = [
    bothAdmission && legacyFeatures.admission_number_match < 1 && 'admission number',
    bothCertificate && legacyFeatures.birth_certificate_match < 1 && 'birth certificate number',
  ].filter(Boolean);
  const reason = exactIdentifiers.length
    ? `Exact ${exactIdentifiers.join(' and ')} match; verify the source documents.`
    : reviewEvidence?.near_match_review
      ? `Near-match evidence across ${(reviewEvidence.signals || []).join(', ')}; administrator review is required. The model score is not a decision.`
    : conflictingIdentifiers.length
      ? `The ${conflictingIdentifiers.join(' and ')} differ between the two records. Agreement is limited to fields that are not unique, so treat these as different beneficiaries unless the documents show otherwise.`
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
      { reference: row.student_id, full_name: first.full_name, is_synthetic: first.is_synthetic, date_of_birth: first.date_of_birth, school: first.school_code || first.school_name, school_code: first.school_code || first.school_name, resolved_school_code: first.school_code, guardian_contact: maskIdentifier(first.primary_phone), admission_number: maskIdentifier(first.admission_number), birth_certificate_number: maskIdentifier(first.birth_certificate_number), guardian_national_id: maskIdentifier(first.guardian_national_id), duplicate_of_student_id: row.student_duplicate_of || null, application_status: row.student_application_status || null },
      { reference: row.matched_student_id, full_name: second.full_name, is_synthetic: second.is_synthetic, date_of_birth: second.date_of_birth, school: second.school_code || second.school_name, school_code: second.school_code || second.school_name, resolved_school_code: second.school_code, guardian_contact: maskIdentifier(second.primary_phone), admission_number: maskIdentifier(second.admission_number), birth_certificate_number: maskIdentifier(second.birth_certificate_number), guardian_national_id: maskIdentifier(second.guardian_national_id), duplicate_of_student_id: row.matched_duplicate_of || null, application_status: row.matched_application_status || null },
    ],
    resolution: row.resolution_id ? {
      id: row.resolution_id,
      canonical_student_id: row.resolution_canonical_student_id,
      duplicate_student_id: row.resolution_duplicate_student_id,
      reason: row.resolution_reason,
      resolved_at: row.resolution_resolved_at,
      resolved_by_name: row.resolution_resolved_by_name || null,
    } : null,
    evidence: {
      name: fieldEvidence(first.full_name, second.full_name, 'name', features.jaro_winkler || 0),
      date_of_birth: features.dob_match >= 1 ? 'matches' : features.dob_match > 0 ? `similar (${Math.round(features.dob_match * 100)}%)` : fieldEvidence(first.date_of_birth, second.date_of_birth),
      school: fieldEvidence(first.school_code, second.school_code, 'school', features.school_match || 0),
      admission_number: features.admission_number_match > 0 ? `similar (${Math.round(features.admission_number_match * 100)}%)` : fieldEvidence(first.admission_number, second.admission_number),
      birth_certificate: features.birth_certificate_match > 0 ? `similar (${Math.round(features.birth_certificate_match * 100)}%)` : fieldEvidence(first.birth_certificate_number, second.birth_certificate_number),
      guardian_national_id: fieldEvidence(first.guardian_national_id, second.guardian_national_id),
      near_match_review: publicReviewEvidence(reviewEvidence),
    },
    model_features: modelFeatures,
  };
}

const evaluationStudentSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  date_of_birth: z.string().optional(),
  school_code: z.string().optional(),
  school_name: z.string().optional(),
  guardian_id: z.string().optional(),
  guardian_name: z.string().optional(),
  guardian_full_name: z.string().optional(),
  admission_number: z.string().trim().min(1).max(100).optional(),
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
      requires_human_review: selectFlaggedCandidates([{
        score: prediction.results[index].score,
        features: prediction.results[index].features,
        reviewEvidence: prediction.results[index].review_evidence,
        exactIdentifiers: exactReviewIdentifierMatches(first, second),
      }], { threshold }).length > 0,
      review_evidence: prediction.results[index].review_evidence,
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
      `SELECT s.id, s.full_name, s.date_of_birth, s.school_code, s.school_name, s.guardian_id,
              s.admission_number, s.birth_certificate_number, s.national_id_number,
              ga.guardian_full_name AS guardian_name,
              guardian_profile.national_id AS guardian_national_id
         FROM students s
         LEFT JOIN LATERAL (
           SELECT guardian_full_name, user_id FROM guardian_applications
            WHERE student_id = s.id
            ORDER BY created_at DESC, id DESC
            LIMIT 1
         ) ga ON TRUE
         LEFT JOIN users guardian_profile
           ON guardian_profile.id::text = COALESCE(NULLIF(s.guardian_id, ''), ga.user_id::text)
        ORDER BY s.created_at ASC, s.id ASC`
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
      // The re-scan is deliberately per-pair, not per-registration: it enumerates the
      // registry for an administrator and skips pairs that already have a flag, so the
      // DUPLICATE_AGGREGATION_POLICY budget used at registration must not apply here.
      const matches = batch.flatMap(({ first, second }, index) => {
        const result = prediction.results[index];
        const exactIdentifiers = exactReviewIdentifierMatches(first, second);
        const selected = selectFlaggedCandidates([{
          candidate: second,
          score: result.score,
          features: result.features,
          reviewEvidence: result.review_evidence,
          exactIdentifiers,
        }], { threshold: reviewThreshold });
        return selected.length
          ? [{ first, second, score: result.score, features: result.features, reviewEvidence: result.review_evidence }]
          : [];
      });
      candidatesFound += matches.length;
      if (!matches.length) return;
      const parameters = [];
      const values = matches.map((match, index) => {
        const position = index * 6;
        parameters.push(match.second.id, match.first.id, match.score, modelVersion, reviewThreshold, {
          ...match.features,
          review_evidence: match.reviewEvidence,
        });
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
              s1.school_name AS student_school_name,
              TO_CHAR(s1.date_of_birth, 'YYYY-MM-DD') AS student_date_of_birth,
              s1.guardian_id AS student_guardian_id,
              s1.admission_number AS student_admission_number,
              s1.birth_certificate_number AS student_birth_certificate_number,
              s1.primary_phone AS student_guardian_contact,
              s2.full_name AS matched_student_name, s2.school_code AS matched_school,
              s2.school_name AS matched_school_name,
              TO_CHAR(s2.date_of_birth, 'YYYY-MM-DD') AS matched_date_of_birth,
              s2.guardian_id AS matched_guardian_id,
              s2.admission_number AS matched_admission_number,
              s2.birth_certificate_number AS matched_birth_certificate_number,
              s2.primary_phone AS matched_guardian_contact,
              s1.duplicate_of_student_id AS student_duplicate_of,
              s2.duplicate_of_student_id AS matched_duplicate_of,
              application1.status AS student_application_status,
              application1.guardian_national_id AS student_guardian_national_id,
              application2.status AS matched_application_status,
              application2.guardian_national_id AS matched_guardian_national_id,
              dfr.id AS resolution_id,
              dfr.canonical_student_id AS resolution_canonical_student_id,
              dfr.duplicate_student_id AS resolution_duplicate_student_id,
              dfr.reason AS resolution_reason,
              dfr.resolved_at AS resolution_resolved_at,
              resolver.full_name AS resolution_resolved_by_name,
              s1.date_of_birth IS NOT DISTINCT FROM s2.date_of_birth AS date_of_birth_match,
              s1.school_code IS NOT DISTINCT FROM s2.school_code AS school_match,
              s1.guardian_id IS NOT DISTINCT FROM s2.guardian_id AS guardian_match,
              (s1.admission_number IS NOT DISTINCT FROM s2.admission_number
                AND s1.school_code IS NOT NULL
                AND s1.school_code IS NOT DISTINCT FROM s2.school_code
                AND s1.admission_number IS NOT NULL) AS admission_number_match
       FROM duplicate_flags df
       JOIN students s1 ON df.student_id = s1.id
       JOIN students s2 ON df.matched_student_id = s2.id
       LEFT JOIN LATERAL (
         SELECT status, guardian_national_id FROM guardian_applications WHERE student_id = s1.id
          ORDER BY created_at DESC, id DESC LIMIT 1
       ) application1 ON TRUE
       LEFT JOIN LATERAL (
         SELECT status, guardian_national_id FROM guardian_applications WHERE student_id = s2.id
          ORDER BY created_at DESC, id DESC LIMIT 1
       ) application2 ON TRUE
       LEFT JOIN duplicate_resolutions dfr ON dfr.duplicate_flag_id = df.id
       LEFT JOIN users resolver ON resolver.id = dfr.resolved_by
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
        high_priority_threshold: getDuplicateThreshold(),
        thresholds_validated: false,
        aggregation_policy: normalizeAggregationPolicy(),
        explanation: 'The model score is an uncalibrated review signal. Thresholds have not been validated on representative reviewed records; no model score makes a final duplicate decision.',
        score_is_calibrated_probability: false,
      },
    });
  } catch (error) {
    next(error);
  }
}

// The review queue deliberately ships masked identifiers so a queue screenshot cannot leak
// a beneficiary's admission number, birth certificate or National ID. A reviewer still has to
// compare those values with the documents a guardian presents, so this endpoint reveals them for
// a single case, only to an administrator, and records who looked at them and when.
async function revealIdentifiers(req, res, next) {
  try {
    if (!CASE_ID_PATTERN.test(String(req.params.id || ''))) {
      return res.status(404).json({ message: 'Duplicate flag not found' });
    }
    const { rows } = await pool.query(
      `SELECT df.id, df.comparison_features,
              s1.id AS student_id, s1.full_name AS student_name,
              s1.is_synthetic AS student_is_synthetic,
              TO_CHAR(s1.date_of_birth, 'YYYY-MM-DD') AS student_date_of_birth,
              s1.school_code AS student_school,
              s1.school_name AS student_school_name,
              s1.primary_phone AS student_guardian_contact,
              s1.admission_number AS student_admission_number,
              s1.birth_certificate_number AS student_birth_certificate_number,
              (SELECT guardian_national_id FROM guardian_applications WHERE student_id = s1.id ORDER BY created_at DESC, id DESC LIMIT 1) AS student_guardian_national_id,
              s2.id AS matched_student_id, s2.full_name AS matched_student_name,
              s2.is_synthetic AS matched_student_is_synthetic,
              TO_CHAR(s2.date_of_birth, 'YYYY-MM-DD') AS matched_date_of_birth,
              s2.school_code AS matched_school,
              s2.school_name AS matched_school_name,
              s2.primary_phone AS matched_guardian_contact,
              s2.admission_number AS matched_admission_number,
              s2.birth_certificate_number AS matched_birth_certificate_number,
              (SELECT guardian_national_id FROM guardian_applications WHERE student_id = s2.id ORDER BY created_at DESC, id DESC LIMIT 1) AS matched_guardian_national_id
       FROM duplicate_flags df
       JOIN students s1 ON df.student_id = s1.id
       JOIN students s2 ON df.matched_student_id = s2.id
       WHERE df.id = $1`,
      [req.params.id]
    );
    const row = rows[0];
    if (!row) return res.status(404).json({ message: 'Duplicate flag not found' });

    const students = [
      {
        reference: row.student_id,
        full_name: row.student_name,
        is_synthetic: row.student_is_synthetic,
        date_of_birth: row.student_date_of_birth,
        school_code: row.student_school,
        school: row.student_school || row.student_school_name,
        guardian_contact: row.student_guardian_contact,
        admission_number: row.student_admission_number,
        birth_certificate_number: row.student_birth_certificate_number,
        guardian_national_id: row.student_guardian_national_id,
      },
      {
        reference: row.matched_student_id,
        full_name: row.matched_student_name,
        is_synthetic: row.matched_student_is_synthetic,
        date_of_birth: row.matched_date_of_birth,
        school_code: row.matched_school,
        school: row.matched_school || row.matched_school_name,
        guardian_contact: row.matched_guardian_contact,
        admission_number: row.matched_admission_number,
        birth_certificate_number: row.matched_birth_certificate_number,
        guardian_national_id: row.matched_guardian_national_id,
      },
    ];

    await logAudit(req.user.id || req.user.sub, 'REVEAL_DUPLICATE_IDENTIFIERS', 'duplicate_flags', row.id, {
      student_ids: [row.student_id, row.matched_student_id],
      fields: REVEALED_IDENTIFIER_FIELDS,
      purpose: 'manual verification of a duplicate-review case',
    });

    res.json({
      case_id: row.id,
      revealed_at: new Date().toISOString(),
      revealed_fields: REVEALED_IDENTIFIER_FIELDS,
      students,
      near_match_evidence: publicReviewEvidence(row.comparison_features?.review_evidence || null, { includeStudentNormalized: true }),
      notice: 'Identifier reveal recorded in the audit log.',
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

    let rejectedApplications = [];
    if (decision === 'confirmed_duplicate') {
      // A flag alone never rejects an application. Once an Admin confirms it, the submitted
      // (flag.student_id) Guardian application is rejected and locked, with the review event
      // above retaining the reviewer, reason and timestamp.
      const rejected = await client.query(
        `UPDATE guardian_applications
            SET status = 'rejected', decision_note = $1, decided_at = NOW(), updated_at = NOW()
          WHERE student_id = $2 AND status <> 'rejected'
          RETURNING id, reference`,
        [reason, flag.student_id],
      );
      rejectedApplications = rejected.rows;
      for (const application of rejectedApplications) {
        await client.query(
          `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
           VALUES ($1, 'GUARDIAN_APPLICATION_REJECTED_DUPLICATE', 'guardian_applications', $2, $3)`,
          [reviewerId, application.id, {
            reference: application.reference,
            duplicate_flag_id: flag.id,
            reason,
            reviewer_id: reviewerId,
          }],
        );
      }
    }

    // Clearing a false positive releases the eligibility hold the flag imposed. The assessment runs
    // inside the same transaction, so the decision is never recorded without it and a retry after a
    // failure is the normal resubmission of the review action.
    let automaticAssessment = null;
    if (decision === 'not_duplicate') {
      const guardianStudent = await guardianStudentInCase(client, flag);
      if (guardianStudent) {
        const application = await latestApplicationForStudent(client, guardianStudent.id);
        automaticAssessment = await assessAutomatically({
          client,
          studentId: guardianStudent.id,
          trigger: 'duplicate_clearance',
          triggerReference: flag.id,
          application,
          actorId: reviewerId,
        });
        const remainingHold = await duplicateBlockReason(client, guardianStudent.id);
        if (!remainingHold && application?.status === 'under_review') {
          const approved = await client.query(
            `UPDATE guardian_applications
                SET status = 'approved', decision_note = NULL, decided_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND status = 'under_review' RETURNING id, reference`,
            [application.id],
          );
          if (approved.rows[0]) {
            await logAudit(reviewerId, 'GUARDIAN_APPLICATION_AUTO_APPROVED', 'guardian_applications', application.id, {
              reference: application.reference,
              reason: 'all_duplicate_reviews_cleared',
            }, client);
          }
        }
      }
    }

    await client.query('COMMIT');
    res.json({
      message: 'Review decision recorded',
      flag,
      automatic_assessment: automaticAssessment,
      rejected_applications: rejectedApplications,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

// Confirming a duplicate must not freeze the legitimate record out of the bursary workflow. This
// endpoint lets an administrator name the canonical record and mark the other one as its duplicate.
// Both rows are kept with their awards, assessments, notifications and audit history; nothing is
// merged, transferred or deleted, and unresolved cases keep blocking award approval.
async function resolve(req, res, next) {
  const validation = resolutionSchema.safeParse(req.body);
  if (!validation.success) {
    return res.status(400).json({ message: 'Select the canonical student record and provide a reason of at least 5 characters.' });
  }
  const actorId = req.user.id || req.user.sub;
  const { canonical_student_id: canonicalId, reason } = validation.data;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise every resolution attempt for this case, so two administrators cannot designate
    // opposite canonical records at the same time.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sbms.duplicate.resolution.${req.params.id}`]);
    const flagResult = await client.query('SELECT * FROM duplicate_flags WHERE id = $1 FOR UPDATE', [req.params.id]);
    const flag = flagResult.rows[0];
    if (!flag) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Duplicate case not found.' });
    }
    if (flag.status !== 'confirmed_duplicate') {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Only a case confirmed as a duplicate can be resolved. Record the review decision first.' });
    }
    const pair = [flag.student_id, flag.matched_student_id];
    if (!pair.includes(canonicalId)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'The canonical record must be one of the two student records in this duplicate case.' });
    }
    const rejectedSubmission = await client.query(
      `SELECT a.id FROM guardian_applications a
        WHERE a.student_id = $1 AND a.status = 'rejected'
          AND EXISTS (
            SELECT 1 FROM duplicate_review_events e
             WHERE e.duplicate_flag_id = $2 AND e.decision = 'confirmed_duplicate'
               AND e.reason = a.decision_note
          )
        LIMIT 1`,
      [flag.student_id, flag.id],
    );
    if (rejectedSubmission.rows.length && canonicalId === flag.student_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        message: 'The application rejected by this duplicate decision cannot be selected as canonical. Choose the matched existing record.',
      });
    }
    const duplicateId = pair.find((id) => id !== canonicalId);
    // A stable lock order over both student rows keeps resolution and award approval from
    // interleaving on the same records.
    const students = await client.query(
      `SELECT id, full_name, admission_number, duplicate_of_student_id FROM students
       WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
      [[...pair].sort()]
    );
    if (students.rows.length !== 2) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Both student records in this case are required to resolve it.' });
    }
    const canonical = students.rows.find((row) => row.id === canonicalId);
    const duplicate = students.rows.find((row) => row.id === duplicateId);
    if (canonical.duplicate_of_student_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'That record is itself marked as a duplicate. Designate the canonical record instead.' });
    }
    if (duplicate.duplicate_of_student_id) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'The other record is already marked as a duplicate. Review its existing resolution before changing it.' });
    }
    const existing = await client.query(
      'SELECT id FROM duplicate_resolutions WHERE duplicate_flag_id = $1',
      [flag.id]
    );
    if (existing.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'This duplicate case is already resolved.' });
    }
    const marked = await client.query(
      `UPDATE students
       SET duplicate_of_student_id = $1, duplicate_marked_at = NOW(), duplicate_marked_by = $2
       WHERE id = $3 AND duplicate_of_student_id IS NULL
       RETURNING id, full_name, admission_number`,
      [canonical.id, actorId, duplicate.id]
    );
    if (!marked.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'The duplicate record was resolved by another request. Reload the case.' });
    }
    const resolution = await client.query(
      `INSERT INTO duplicate_resolutions
         (duplicate_flag_id, canonical_student_id, duplicate_student_id, reason, resolved_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [flag.id, canonical.id, duplicate.id, reason, actorId]
    );
    await client.query('UPDATE duplicate_flags SET updated_at = NOW() WHERE id = $1', [flag.id]);
    // An award already attached to the duplicate record is reported, never moved. The administrator
    // has to reject or void it explicitly; approval stays blocked while it is open.
    const duplicateAwards = await client.query(
      `SELECT id, status, award_year, requested_amount, approved_amount
       FROM bursary_awards WHERE student_id = $1 AND status IN ('submitted', 'approved')
       ORDER BY created_at DESC`,
      [duplicate.id]
    );
    await client.query(
      `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
       VALUES ($1, 'DUPLICATE_CASE_RESOLVED', 'duplicate_flags', $2, $3)`,
      [actorId, flag.id, {
        canonical_student_id: canonical.id,
        duplicate_student_id: duplicate.id,
        reason,
        model_version: flag.model_version,
        model_score: flag.probability,
        duplicate_open_awards: duplicateAwards.rows.map((award) => award.id),
      }]
    );
    await client.query('COMMIT');
    res.status(201).json({
      message: `${duplicate.full_name} is now recorded as a duplicate of ${canonical.full_name}. Only the canonical record can receive a bursary.`,
      resolution: resolution.rows[0],
      canonical_student: { id: canonical.id, full_name: canonical.full_name, admission_number: canonical.admission_number },
      duplicate_student: { id: duplicate.id, full_name: duplicate.full_name, admission_number: duplicate.admission_number },
      duplicate_open_awards: duplicateAwards.rows,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { evaluate, list, revealIdentifiers, resolve, scanExisting, update };

