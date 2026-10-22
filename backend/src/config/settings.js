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

module.exports = {
  getDuplicateThreshold,
  setDuplicateThreshold,
  getReviewThreshold,
  setReviewThreshold,
  getMlReviewScoreThreshold,
  setMlReviewScoreThreshold,
};
