const {
  getDuplicateThreshold,
  setDuplicateThreshold
} = require('../config/settings');

function getThreshold(req, res) {
  res.json({
    threshold: getDuplicateThreshold()
  });
}

function updateThreshold(req, res) {
  const { threshold } = req.body;

  if (typeof threshold !== 'number' || threshold < 0 || threshold > 1) {
    return res.status(400).json({
      message: 'Threshold must be a number between 0 and 1'
    });
  }

  setDuplicateThreshold(threshold);

  res.json({
    message: 'Duplicate threshold updated successfully',
    threshold
  });
}

module.exports = {
  getThreshold,
  updateThreshold
};
