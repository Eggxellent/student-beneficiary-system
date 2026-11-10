/**
 * Financial-need eligibility scoring for the SBMS bursary workflow.
 *
 * Score out of 100 - five weighted factors, each scored independently:
 *
 *   Factor                     Max   Rule
 *   ------------------------  ----  --------------------------------------------
 *   Fee balance                 30   >= 50,000 -> 30 | >= 30,000 -> 25
 *                                    >= 15,000 -> 15 | > 0 -> 5 | 0 -> 0
 *   Household income            25   <= 20,000 -> 25 | <= 40,000 -> 20
 *                                    <= 60,000 -> 10 | above -> 0
 *   Vulnerability status        25   high -> 25 | medium -> 15 | low -> 5
 *   Siblings in school          10   >= 4 -> 10 | >= 2 -> 7 | 1 -> 3 | 0 -> 0
 *   Prior bursary history       10   none -> 10 | low -> 7 | high -> 2
 *
 * Category bands (need level, not an approval decision):
 *   score >= 70 -> high | 40-69 -> moderate | < 40 -> low
 *
 * The cash range attached to each band comes from configurable settings and is
 * flagged provisional unless approved ranges are configured. The output is a
 * recommendation for the authorised officer; it never approves a bursary.
 */
const { getEligibilityAmountRanges } = require('../config/settings');

const FACTOR_MAX = {
  fee_balance: 30,
  household_income: 25,
  vulnerability_status: 25,
  siblings_in_school: 10,
  prior_bursary_history: 10,
};

const CATEGORY_LABELS = { high: 'High', moderate: 'Moderate', low: 'Low' };

const CATEGORY_BANDS = [
  { category: 'high', label: 'High', min: 70, max: 100 },
  { category: 'moderate', label: 'Moderate', min: 40, max: 69 },
  { category: 'low', label: 'Low', min: 0, max: 39 },
];

function feeBalancePoints(feeBalance) {
  if (feeBalance >= 50000) return [30, 'High outstanding school fees'];
  if (feeBalance >= 30000) return [25, 'Significant outstanding school fees'];
  if (feeBalance >= 15000) return [15, 'Moderate outstanding school fees'];
  if (feeBalance > 0) return [5, 'Outstanding school fees'];
  return [0, 'No outstanding school fees'];
}

function householdIncomePoints(householdIncome) {
  if (householdIncome <= 20000) return [25, 'Very low household income'];
  if (householdIncome <= 40000) return [20, 'Low household income'];
  if (householdIncome <= 60000) return [10, 'Moderate household income'];
  return [0, 'Household income is above the scoring threshold'];
}

function vulnerabilityPoints(vulnerabilityStatus) {
  if (vulnerabilityStatus === 'high') return [25, 'High vulnerability level'];
  if (vulnerabilityStatus === 'medium') return [15, 'Medium vulnerability level'];
  return [5, 'Low vulnerability level'];
}

function siblingsPoints(siblingsInSchool) {
  if (siblingsInSchool >= 4) return [10, 'Four or more siblings are in school'];
  if (siblingsInSchool >= 2) return [7, 'Multiple siblings are in school'];
  if (siblingsInSchool === 1) return [3, 'One sibling is in school'];
  return [0, 'No siblings are currently in school'];
}

function priorBursaryPoints(priorBursaryHistory) {
  if (priorBursaryHistory === 'none') return [10, 'No previous bursary received'];
  if (priorBursaryHistory === 'low') return [7, 'Limited previous bursary assistance'];
  return [2, 'Substantial previous bursary assistance'];
}

function categoryForScore(score) {
  if (score >= 70) return 'high';
  if (score >= 40) return 'moderate';
  return 'low';
}

function calculateEligibility({
  fee_balance = 0,
  household_income = 0,
  vulnerability_status = 'low',
  siblings_in_school = 0,
  prior_bursary_history = 'none',
} = {}) {
  const vulnerable = String(vulnerability_status).toLowerCase();
  const previous = String(prior_bursary_history).toLowerCase();

  const scored = [
    ['fee_balance', 'Fee balance', ...feeBalancePoints(fee_balance)],
    ['household_income', 'Household income', ...householdIncomePoints(household_income)],
    ['vulnerability_status', 'Vulnerability status', ...vulnerabilityPoints(vulnerable)],
    ['siblings_in_school', 'Siblings in school', ...siblingsPoints(siblings_in_school)],
    ['prior_bursary_history', 'Prior bursary history', ...priorBursaryPoints(previous)],
  ];

  const breakdown = {};
  const reasons = [];
  const factors = scored.map(([key, label, points, detail]) => {
    breakdown[key] = points;
    reasons.push(detail);
    return { key, label, points, max_points: FACTOR_MAX[key], detail };
  });

  const score = factors.reduce((total, factor) => total + factor.points, 0);
  const category = categoryForScore(score);

  const amountRanges = getEligibilityAmountRanges();
  const band = amountRanges.ranges[category] || { min: 0, max: 0 };

  return {
    score,
    max_score: 100,
    category,
    category_label: CATEGORY_LABELS[category],
    breakdown,
    reasons,
    factors,
    recommended_range: {
      currency: amountRanges.currency,
      min: band.min,
      max: band.max,
      provisional: amountRanges.provisional,
      source: amountRanges.source,
    },
    formula: {
      scale: 'Score out of 100 - five weighted factors',
      factors: factors.map((factor) => ({
        key: factor.key,
        label: factor.label,
        max_points: factor.max_points,
      })),
      category_bands: CATEGORY_BANDS,
      amount_ranges: amountRanges.ranges,
      amount_ranges_provisional: amountRanges.provisional,
    },
    guidance:
      'Recommendation only. An authorised officer must verify the details and approve or reject the bursary.',
  };
}

module.exports = {
  calculateEligibility,
  CATEGORY_BANDS,
  CATEGORY_LABELS,
};
