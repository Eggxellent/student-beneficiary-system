let duplicateThreshold = 0.70;

function getDuplicateThreshold() {
  return duplicateThreshold;
}

function setDuplicateThreshold(value) {
  duplicateThreshold = value;
}

module.exports = {
  getDuplicateThreshold,
  setDuplicateThreshold
};
