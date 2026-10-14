let duplicateThreshold = 0.70;
let reviewThreshold = 0.30;

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

module.exports = {
  getDuplicateThreshold,
  setDuplicateThreshold,
  getReviewThreshold,
  setReviewThreshold,
};
