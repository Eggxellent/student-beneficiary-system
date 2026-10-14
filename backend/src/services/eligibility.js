function calculateEligibility({
  fee_balance = 0,
  household_income = 0,
  vulnerability_status = "low",
  siblings_in_school = 0,
  prior_bursary_history = "none",
}) {
  const breakdown = {};
  const reasons = [];

  if (fee_balance >= 50000) {
    breakdown.fee_balance = 30;
    reasons.push("High outstanding school fees");
  } else if (fee_balance >= 30000) {
    breakdown.fee_balance = 25;
    reasons.push("Significant outstanding school fees");
  } else if (fee_balance >= 15000) {
    breakdown.fee_balance = 15;
    reasons.push("Moderate outstanding school fees");
  } else if (fee_balance > 0) {
    breakdown.fee_balance = 5;
    reasons.push("Outstanding school fees");
  } else {
    breakdown.fee_balance = 0;
    reasons.push("No outstanding school fees");
  }

  if (household_income <= 20000) {
    breakdown.household_income = 25;
    reasons.push("Very low household income");
  } else if (household_income <= 40000) {
    breakdown.household_income = 20;
    reasons.push("Low household income");
  } else if (household_income <= 60000) {
    breakdown.household_income = 10;
    reasons.push("Moderate household income");
  } else {
    breakdown.household_income = 0;
    reasons.push("Household income is above the scoring threshold");
  }

  const vulnerability = vulnerability_status.toLowerCase();
  if (vulnerability === "high") {
    breakdown.vulnerability_status = 25;
    reasons.push("High vulnerability level");
  } else if (vulnerability === "medium") {
    breakdown.vulnerability_status = 15;
    reasons.push("Medium vulnerability level");
  } else {
    breakdown.vulnerability_status = 5;
    reasons.push("Low vulnerability level");
  }

  if (siblings_in_school >= 4) {
    breakdown.siblings_in_school = 10;
    reasons.push("Four or more siblings are in school");
  } else if (siblings_in_school >= 2) {
    breakdown.siblings_in_school = 7;
    reasons.push("Multiple siblings are in school");
  } else if (siblings_in_school === 1) {
    breakdown.siblings_in_school = 3;
    reasons.push("One sibling is in school");
  } else {
    breakdown.siblings_in_school = 0;
    reasons.push("No siblings are currently in school");
  }

  const previous = prior_bursary_history.toLowerCase();
  if (previous === "none") {
    breakdown.prior_bursary_history = 10;
    reasons.push("No previous bursary received");
  } else if (previous === "low") {
    breakdown.prior_bursary_history = 7;
    reasons.push("Limited previous bursary assistance");
  } else {
    breakdown.prior_bursary_history = 2;
    reasons.push("Substantial previous bursary assistance");
  }

  const score = Object.values(breakdown).reduce(
    (total, points) => total + points,
    0
  );

  let category;
  if (score >= 75) {
    category = "highly_eligible";
  } else if (score >= 50) {
    category = "eligible";
  } else if (score >= 30) {
    category = "partially_eligible";
  } else {
    category = "not_eligible";
  }

  return {
    score,
    category,
    breakdown,
    reasons,
  };
}

module.exports = {
  calculateEligibility,
};