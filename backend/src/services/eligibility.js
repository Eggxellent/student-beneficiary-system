function calculateEligibility({
  fee_balance,
  household_income,
  vulnerability_status,
  siblings_in_school,
  prior_bursary_history
}) {
  let score = 0;

  // 1. Fee balance - 30 points
  if (fee_balance >= 50000) {
    score += 30;
  } else if (fee_balance >= 30000) {
    score += 25;
  } else if (fee_balance >= 15000) {
    score += 15;
  } else if (fee_balance > 0) {
    score += 5;
  }

  // 2. Household income - 25 points
  if (household_income <= 20000) {
    score += 25;
  } else if (household_income <= 40000) {
    score += 20;
  } else if (household_income <= 60000) {
    score += 10;
  }

  // 3. Vulnerability status - 25 points
  if (vulnerability_status === 'high') {
    score += 25;
  } else if (vulnerability_status === 'medium') {
    score += 15;
  } else if (vulnerability_status === 'low') {
    score += 5;
  }

  // 4. Siblings in school - 10 points
  if (siblings_in_school >= 4) {
    score += 10;
  } else if (siblings_in_school >= 2) {
    score += 7;
  } else if (siblings_in_school === 1) {
    score += 3;
  }

  // 5. Prior bursary history - 10 points
  // Students who have received little/no previous support receive more points.
  if (prior_bursary_history === 'none') {
    score += 10;
  } else if (prior_bursary_history === 'low') {
    score += 7;
  } else if (prior_bursary_history === 'high') {
    score += 2;
  }

  let category;

  if (score >= 75) {
    category = 'highly_eligible';
  } else if (score >= 50) {
    category = 'eligible';
  } else if (score >= 30) {
    category = 'partially_eligible';
  } else {
    category = 'not_eligible';
  }

  return {
    score,
    max_score: 100,
    category
  };
}

module.exports = calculateEligibility;
