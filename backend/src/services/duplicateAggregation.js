/**
 * Registration-level duplicate flag aggregation.
 *
 * The Python predictor scores *pairs*: one submitted record against one existing
 * student. Registration needs *cases* for human review, and the number of cases a
 * single registration may create is a policy decision, not a model decision. It
 * lives here so it can be reviewed, switched, and unit-tested without touching the
 * model or the database.
 *
 * Why this module exists: until 2026-10-30 registration inserted a flag for every
 * candidate pair that reached the cutoff. With N existing students and per-pair
 * false-positive rate p, a legitimate registration was flagged with probability
 * 1 - (1 - p)^N (97% at N = 1000, p = 0.35%). See
 * docs/SBMS_PROJECT_HANDOVER_2026-10.md section 4.3.
 *
 * Policies (DUPLICATE_AGGREGATION_POLICY):
 *
 *   top-1               Default. At most one flag per registration: the single best
 *                       qualifying candidate, ranking exact identifier agreement
 *                       above model score. Still requires evaluation against
 *                       adjudicated pairs (Phase 2), but it bounds the queue.
 *
 *   top-1-corroborated  As top-1, but a flag is only created when at least two
 *                       independent fields corroborate the match, or an identifier
 *                       matches exactly. EXPERIMENTAL: it deliberately suppresses
 *                       weak single-field candidates and has not been evaluated
 *                       against adjudicated pairs, so it may raise the miss rate.
 *
 *   all                 Legacy behaviour, retained only to reproduce and compare
 *                       against the defect it replaces. One flag per candidate pair.
 *
 * This module never changes a score, a threshold, or the model. It only selects
 * which already-scored candidates become flags.
 */

const AGGREGATION_POLICIES = Object.freeze(['top-1', 'top-1-corroborated', 'all']);
const DEFAULT_AGGREGATION_POLICY = 'top-1';
const CORROBORATION_MINIMUM_SIMILARITY = 0.99;
const CORROBORATION_MINIMUM_FIELDS = 2;

// Fields that can independently corroborate a match. Name similarity and school
// are excluded on purpose: names collide often and most applicants share a school,
// so neither is independent evidence on its own.
const CORROBORATION_FIELDS = Object.freeze([
  'dob_match',
  'guardian_match',
  'upi_match',
  'birth_certificate_match',
  'national_id_match',
]);

function normalizeAggregationPolicy(value = process.env.DUPLICATE_AGGREGATION_POLICY) {
  const policy = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (!policy) return DEFAULT_AGGREGATION_POLICY;
  if (!AGGREGATION_POLICIES.includes(policy)) {
    throw new Error(`DUPLICATE_AGGREGATION_POLICY must be one of: ${AGGREGATION_POLICIES.join(', ')}`);
  }
  return policy;
}

function corroboratingFields(features) {
  const values = features || {};
  return CORROBORATION_FIELDS.filter((field) => Number(values[field]) >= CORROBORATION_MINIMUM_SIMILARITY);
}

function qualifiesForReview(candidate, threshold) {
  return candidate.score >= threshold || candidate.exactIdentifiers.length > 0;
}

function compareCandidates(left, right) {
  const leftExact = left.exactIdentifiers.length > 0 ? 1 : 0;
  const rightExact = right.exactIdentifiers.length > 0 ? 1 : 0;
  if (leftExact !== rightExact) return rightExact - leftExact;
  if (left.score !== right.score) return right.score - left.score;
  return left.index - right.index;
}

/**
 * Select the candidates that become duplicate flags for one registration.
 *
 * @param {Array<{candidate?: object, score: number, features?: object, exactIdentifiers?: string[]}>} candidates
 *   Already-scored candidates, in the order they were compared (creation order).
 * @param {{policy?: string, threshold: number}} options
 * @returns {Array<object>} Selected candidates; length is bounded by the policy.
 */
function selectFlaggedCandidates(candidates, options = {}) {
  const threshold = Number(options.threshold);
  if (!Number.isFinite(threshold)) {
    throw new TypeError('threshold must be a finite number');
  }
  const policy = options.policy === undefined
    ? normalizeAggregationPolicy()
    : normalizeAggregationPolicy(options.policy);

  const prepared = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => ({
    ...candidate,
    exactIdentifiers: Array.isArray(candidate.exactIdentifiers) ? candidate.exactIdentifiers : [],
    corroboratingFields: corroboratingFields(candidate.features),
    index,
  }));

  const qualifying = prepared.filter((candidate) => qualifiesForReview(candidate, threshold));
  if (policy === 'all') return qualifying;
  if (qualifying.length === 0) return [];

  const [best] = qualifying.sort(compareCandidates);

  if (
    policy === 'top-1-corroborated'
    && best.exactIdentifiers.length === 0
    && best.corroboratingFields.length < CORROBORATION_MINIMUM_FIELDS
  ) {
    return [];
  }

  return [best];
}

/**
 * Counts for the audit log and API response, so a suppressed candidate is never
 * invisible to the reviewer or the operator.
 */
function summarizeAggregation(candidates, flagged, options = {}) {
  const threshold = Number(options.threshold);
  if (!Number.isFinite(threshold)) {
    throw new TypeError('threshold must be a finite number');
  }
  const policy = options.policy === undefined
    ? normalizeAggregationPolicy()
    : normalizeAggregationPolicy(options.policy);
  const list = Array.isArray(candidates) ? candidates : [];
  const qualifying = list.filter((candidate) => (
    Number(candidate.score) >= threshold
    || (Array.isArray(candidate.exactIdentifiers) && candidate.exactIdentifiers.length > 0)
  ));
  const selected = Array.isArray(flagged) ? flagged.length : 0;
  return {
    policy,
    candidates_considered: list.length,
    candidates_qualifying: qualifying.length,
    flags_selected: selected,
    candidates_suppressed: Math.max(0, qualifying.length - selected),
  };
}

module.exports = {
  AGGREGATION_POLICIES,
  CORROBORATION_FIELDS,
  CORROBORATION_MINIMUM_FIELDS,
  CORROBORATION_MINIMUM_SIMILARITY,
  DEFAULT_AGGREGATION_POLICY,
  corroboratingFields,
  normalizeAggregationPolicy,
  selectFlaggedCandidates,
  summarizeAggregation,
};
