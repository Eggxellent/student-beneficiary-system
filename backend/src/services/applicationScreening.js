'use strict';

// Screening for guardian-led applications.
//
// The pipeline is the registration pipeline, unchanged: score the submission against the register,
// let `duplicateAggregation` decide which candidates become cases, then insert those cases. Only two
// things differ, and both are deliberate (docs/guardian-led-workflow.md, docs/ml-screening-audit-2026-11-16.md):
//
//   1. Candidates are read without `FOR UPDATE`. A public submission must never hold a table-wide
//      lock, and the two unique indexes on `duplicate_flags` already prevent a duplicate case.
//   2. A predictor failure does not fail the submission. It is recorded as
//      `screening_failure_code`, so "not screened" is never displayed as "screened clean".
//
// The model score is advisory. This module never approves, rejects, or merges anything.

const { exactReviewIdentifierMatches, reviewPriority, scorePairs, configuredThreshold, dateOnly } = require('./mlDuplicateReview');
const { getDuplicateThreshold } = require('../config/settings');
const { selectFlaggedCandidates, summarizeAggregation, normalizeAggregationPolicy } = require('./duplicateAggregation');

const SCREENING_UNAVAILABLE = 'DUPLICATE_SCREENING_UNAVAILABLE';

const CANDIDATE_COLUMNS = `id, full_name, date_of_birth, school_code, guardian_id, upi,
  birth_certificate_number, national_id_number`;

/** The part of an application the predictor compares; identifiers stay optional. */
function screeningSubject(application) {
  return {
    full_name: application.full_name,
    date_of_birth: dateOnly(application.date_of_birth),
    school_code: application.school_code,
    upi: application.upi,
    birth_certificate_number: application.birth_certificate_number,
    national_id_number: application.national_id_number,
  };
}

/**
 * Score one application against already-loaded candidates.
 *
 * Exported separately from the database work so the scoring rules can be unit-tested without a
 * database and without the Python bridge.
 */
async function scoreApplication(application, candidates) {
  const policy = normalizeAggregationPolicy();
  const subject = screeningSubject(application);
  const rows = Array.isArray(candidates) ? candidates : [];

  if (rows.length === 0) {
    // An empty register has nothing to match. Calling the bridge with zero pairs would spend a
    // subprocess on a question whose answer is already known.
    return {
      prediction: { model_version: null, results: [] },
      threshold: configuredThreshold(),
      policy,
      aggregation: { policy, candidates_considered: 0, candidates_qualifying: 0, candidates_guardian_only: 0, candidates_suppressed: 0 },
      cases: [],
      failureCode: null,
    };
  }

  let prediction;
  try {
    prediction = await scorePairs(rows.map((candidate) => ({ first: subject, second: candidate })));
  } catch (error) {
    return {
      prediction: null,
      threshold: null,
      policy,
      aggregation: null,
      cases: [],
      failureCode: SCREENING_UNAVAILABLE,
      failureMessage: error.message,
    };
  }

  const threshold = configuredThreshold();
  const scoredCandidates = rows.map((candidate, index) => ({
    candidate,
    score: prediction.results[index].score,
    features: prediction.results[index].features,
    exactIdentifiers: exactReviewIdentifierMatches(subject, candidate),
  }));
  const cases = selectFlaggedCandidates(scoredCandidates, { policy, threshold });
  const aggregation = summarizeAggregation(scoredCandidates, cases, { policy, threshold });
  return { prediction, threshold, policy, aggregation, cases, failureCode: null };
}

/**
 * Screen a stored application and record the outcome on its row, in the caller's transaction.
 *
 * @param {{query: Function}} client PostgreSQL client or pool
 * @param {string} applicationId
 * @returns {Promise<{status: string, failureCode: string|null, cases: Array<object>, aggregation: object|null}>}
 */
async function screenApplication(client, applicationId) {
  const { rows: applicationRows } = await client.query(
    `SELECT id, full_name, date_of_birth, school_code, upi, birth_certificate_number, national_id_number
       FROM student_applications WHERE id = $1`,
    [applicationId],
  );
  const application = applicationRows[0];
  if (!application) throw new Error(`Application ${applicationId} not found`);

  const { rows: candidates } = await client.query(
    `SELECT ${CANDIDATE_COLUMNS} FROM students ORDER BY created_at ASC, id ASC`,
  );

  const result = await scoreApplication(application, candidates);
  const priority = screeningPriority(result);

  await client.query(
    `UPDATE student_applications
        SET status = 'screened',
            screening_score = $2,
            screening_model_version = $3,
            screening_threshold = $4,
            screening_priority = $5,
            screening_failure_code = $6,
            screened_at = NOW(),
            candidates_considered = $7,
            candidates_qualifying = $8,
            candidates_suppressed = $9,
            updated_at = NOW()
      WHERE id = $1`,
    [
      applicationId,
      result.cases.length ? Math.max(...result.cases.map((entry) => entry.score)) : null,
      result.prediction ? result.prediction.model_version : null,
      result.threshold,
      priority,
      result.failureCode,
      result.aggregation ? result.aggregation.candidates_considered : candidates.length,
      result.aggregation ? result.aggregation.candidates_qualifying : null,
      result.aggregation ? result.aggregation.candidates_suppressed : null,
    ],
  );

  const inserted = [];
  for (const entry of result.cases) {
    const { rows } = await client.query(
      `INSERT INTO duplicate_flags
         (application_id, matched_student_id, probability, status, model_version, review_threshold, comparison_features)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [applicationId, entry.candidate.id, entry.score, result.prediction.model_version, result.threshold, entry.features],
    );
    if (rows[0]) inserted.push(rows[0]);
  }

  return {
    status: 'screened',
    failureCode: result.failureCode,
    cases: inserted,
    aggregation: result.aggregation,
    model_version: result.prediction ? result.prediction.model_version : null,
  };
}

module.exports = {
  SCREENING_UNAVAILABLE,
  CANDIDATE_COLUMNS,
  screeningSubject,
  scoreApplication,
  screeningPriority,
  screenApplication,
};

function screeningPriority(result) {
  if (!result.cases.length) return 'none';
  const best = result.cases.reduce((left, right) => (right.score > left.score ? right : left));
  return reviewPriority({
    score: best.score,
    highPriorityThreshold: getDuplicateThreshold(),
    exactIdentifierCount: best.exactIdentifiers.length,
  });
}
