function configuredThreshold(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback;
}

let duplicateThreshold = configuredThreshold('DUPLICATE_HIGH_PRIORITY_THRESHOLD', 0.70);
let reviewThreshold = configuredThreshold('DUPLICATE_REVIEW_THRESHOLD', 0.30);
let mlReviewScoreThreshold = configuredThreshold('ML_REVIEW_SCORE_THRESHOLD', 0.50);

function getDuplicateThreshold() {
  return duplicateThreshold;
}

function setDuplicateThreshold(value) {
  duplicateThreshold = value;
}

function getReviewThreshold() {
  return reviewThreshold;
}

function setReviewThreshold(value) {
  reviewThreshold = value;
}

function getMlReviewScoreThreshold() {
  return mlReviewScoreThreshold;
}

function setMlReviewScoreThreshold(value) {
  mlReviewScoreThreshold = value;
}

/*
 * Bursary amount ranges used to translate an eligibility category into a
 * recommended cash range (KSh). No official NG-CDF allocation limits are
 * assumed: if the six environment variables below are not all set, the
 * built-in figures are reported as PROVISIONAL proposals only.
 *
 *   ELIGIBILITY_RANGE_HIGH_MIN / ELIGIBILITY_RANGE_HIGH_MAX
 *   ELIGIBILITY_RANGE_MODERATE_MIN / ELIGIBILITY_RANGE_MODERATE_MAX
 *   ELIGIBILITY_RANGE_LOW_MIN / ELIGIBILITY_RANGE_LOW_MAX
 */
const PROVISIONAL_RANGES = {
  high: { min: 15000, max: 25000 },
  moderate: { min: 8000, max: 15000 },
  low: { min: 3000, max: 8000 },
};

function configuredAmount(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function approvedRange(category) {
  const min = configuredAmount(`ELIGIBILITY_RANGE_${category.toUpperCase()}_MIN`);
  const max = configuredAmount(`ELIGIBILITY_RANGE_${category.toUpperCase()}_MAX`);
  if (min === null || max === null || max < min) return null;
  return { min, max };
}

function getEligibilityAmountRanges() {
  const configured = {};
  for (const category of Object.keys(PROVISIONAL_RANGES)) {
    configured[category] = approvedRange(category);
  }

  const approved = Object.values(configured).every(Boolean);
  const ranges = approved ? configured : PROVISIONAL_RANGES;

  return {
    currency: 'KES',
    provisional: !approved,
    source: approved
      ? 'Configured in server environment (ELIGIBILITY_RANGE_*)'
      : 'Provisional proposal - no approved allocation ranges configured',
    ranges,
  };
}

module.exports = {
  getDuplicateThreshold,
  setDuplicateThreshold,
  getReviewThreshold,
  setReviewThreshold,
  getMlReviewScoreThreshold,
  setMlReviewScoreThreshold,
  getEligibilityAmountRanges,
};
