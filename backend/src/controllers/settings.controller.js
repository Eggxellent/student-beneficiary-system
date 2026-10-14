const {
  getDuplicateThreshold,
  setDuplicateThreshold,
  getReviewThreshold,
  setReviewThreshold,
} = require('../config/settings');

function getThreshold(req, res) {
  res.json({
    threshold: getDuplicateThreshold(),
    reviewThreshold: getReviewThreshold(),
  });
}

function updateThreshold(req, res) {
  const { threshold, reviewThreshold } = req.body;

  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    return res.status(400).json({
      message: 'Threshold must be a number between 0 and 1'
    });
  }

  if (reviewThreshold !== undefined && (typeof reviewThreshold !== 'number' || reviewThreshold < 0 || reviewThreshold > 1)) {
    return res.status(400).json({
      message: 'Review threshold must be a number between 0 and 1'
    });
  }

  if (reviewThreshold !== undefined && threshold < reviewThreshold) {
    return res.status(400).json({
      message: 'Duplicate threshold must be greater than or equal to the review threshold'
    });
  }

  setDuplicateThreshold(threshold);

  if (reviewThreshold !== undefined) {
    setReviewThreshold(reviewThreshold);
  }

  res.json({
    message: 'Duplicate thresholds updated successfully',
    threshold,
    reviewThreshold: getReviewThreshold(),
  });
}

module.exports = {
  getThreshold,
  updateThreshold,
};
