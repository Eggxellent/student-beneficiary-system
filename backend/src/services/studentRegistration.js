/**
 * Shared student intake: duplicate screening plus the student and duplicate-flag writes.
 *
 * Guardian submissions and the (removed) field-officer registration form both need the same
 * screening and the same flag creation. Guardian submissions are the only caller now, but the
 * screening path is kept in one place so it cannot drift from the duplicate-review workflow.
 *
 * The caller owns the transaction and must already have locked the registration advisory lock,
 * because the candidate scan locks the students table while the model scores the pairs.
 */
const { randomBytes } = require('crypto');
const studentModel = require('../models/student.model');
const logAudit = require('./auditLog');
const { scorePairs, exactReviewIdentifierMatches, reviewPriority, configuredThreshold } = require('./mlDuplicateReview');
const { getDuplicateThreshold } = require('../config/settings');
const { selectFlaggedCandidates, summarizeAggregation, normalizeAggregationPolicy } = require('./duplicateAggregation');

class DuplicateScreeningUnavailableError extends Error {
  constructor() {
    super('Duplicate screening is unavailable');
    this.name = 'DuplicateScreeningUnavailableError';
    this.code = 'DUPLICATE_SCREENING_UNAVAILABLE';
  }
}

async function screenAndCreateStudent({ client, submitted, actorId, schoolName = null, source, applicationId = null }) {
  const threshold = configuredThreshold();
  const aggregationPolicy = normalizeAggregationPolicy();

  await client.query("SELECT pg_advisory_xact_lock(hashtext('sbms.student.registration'))");
  const { rows: candidates } = await client.query(
    `SELECT s.id, s.full_name, s.date_of_birth, s.school_code, s.school_name, s.guardian_id,
            s.admission_number, s.birth_certificate_number, s.national_id_number,
            ga.guardian_full_name AS guardian_name
       FROM students s
       LEFT JOIN LATERAL (
         SELECT guardian_full_name FROM guardian_applications
          WHERE student_id = s.id
          ORDER BY created_at DESC, id DESC
          LIMIT 1
       ) ga ON TRUE
      ORDER BY s.created_at ASC, s.id ASC FOR UPDATE OF s`
  );

  let prediction;
  try {
    prediction = await scorePairs(candidates.map((candidate) => ({ first: submitted, second: candidate })));
  } catch (error) {
    // Nothing has been written yet, so the caller can roll back and let the guardian retry.
    throw new DuplicateScreeningUnavailableError();
  }

  const scoredCandidates = candidates.map((candidate, index) => {
    const result = prediction.results[index];
    return {
      candidate,
      score: result.score,
      features: result.features,
      reviewEvidence: result.review_evidence,
      exactIdentifiers: exactReviewIdentifierMatches(submitted, candidate),
    };
  });
  const duplicateResults = selectFlaggedCandidates(scoredCandidates, { policy: aggregationPolicy, threshold });
  const aggregation = summarizeAggregation(scoredCandidates, duplicateResults, { policy: aggregationPolicy, threshold });

  const student = await studentModel.create(
    {
      ...submitted,
      school_name: schoolName,
      qr_token: randomBytes(32).toString('hex'),
    },
    client,
  );

  const flags = [];
  for (const result of duplicateResults) {
    const { rows } = await client.query(
      `INSERT INTO duplicate_flags
         (student_id, matched_student_id, probability, status, model_version, review_threshold, comparison_features)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6)
       ON CONFLICT DO NOTHING RETURNING *`,
      [student.id, result.candidate.id, result.score, prediction.model_version, threshold, {
        ...result.features,
        review_evidence: result.reviewEvidence,
      }]
    );
    if (!rows[0]) continue;
    flags.push({
      ...rows[0],
      model_score: result.score,
      priority: reviewPriority({
        score: result.score,
        highPriorityThreshold: getDuplicateThreshold(),
        exactIdentifierCount: result.exactIdentifiers.length,
      }),
      exact_identifier_matches: result.exactIdentifiers,
      review_reason: result.exactIdentifiers.length
        ? `Exact ${result.exactIdentifiers.join(' and ')} match; an administrator must verify the source documents.`
        : result.reviewEvidence?.near_match_review
          ? `Near-match evidence across ${result.reviewEvidence.signals.join(', ')}; administrator review is required. The model score is not a decision.`
          : `Model score met the provisional human-review cutoff (${threshold.toFixed(2)}).`,
    });
  }

  await logAudit(actorId, 'CREATE', 'students', student.id, {
    registration_source: source,
    guardian_application_id: applicationId,
    duplicate_model_version: prediction.model_version,
    duplicate_review_threshold: threshold,
    duplicate_aggregation_policy: aggregation.policy,
    duplicate_candidates_considered: aggregation.candidates_considered,
    duplicate_candidates_qualifying: aggregation.candidates_qualifying,
    duplicate_candidates_guardian_only: aggregation.candidates_guardian_only,
    duplicate_candidates_near_match: aggregation.candidates_near_match,
    duplicate_candidates_suppressed: aggregation.candidates_suppressed,
    duplicate_flags_created: flags.length,
  }, client);

  return {
    student,
    flags,
    screening: {
      model_version: prediction.model_version,
      review_threshold: threshold,
      high_priority_threshold: getDuplicateThreshold(),
      thresholds_validated: false,
      score_is_calibrated_probability: false,
      aggregation_policy: aggregation.policy,
      candidates_considered: aggregation.candidates_considered,
      candidates_qualifying: aggregation.candidates_qualifying,
      candidates_guardian_only: aggregation.candidates_guardian_only,
      candidates_near_match: aggregation.candidates_near_match,
      candidates_suppressed: aggregation.candidates_suppressed,
      flagged: flags.length > 0,
    },
  };
}

module.exports = { screenAndCreateStudent, DuplicateScreeningUnavailableError };
