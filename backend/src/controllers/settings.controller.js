const {
  getDuplicateThreshold,
  setDuplicateThreshold,
  getReviewThreshold,
  setReviewThreshold,
  getMlReviewScoreThreshold,
  setMlReviewScoreThreshold,
} = require('../config/settings');
const logAudit = require('../services/auditLog');

function getThreshold(req, res) {
  res.json({
    threshold: getDuplicateThreshold(),
    reviewThreshold: getReviewThreshold(),
    mlReviewThreshold: getMlReviewScoreThreshold(),
    scoreIsCalibratedProbability: false,
  });
}

async function updateThreshold(req, res, next) {
  const { threshold, reviewThreshold, mlReviewThreshold } = req.body;

  if (threshold !== undefined && (typeof threshold !== 'number' || threshold < 0 || threshold > 1)) {
    return res.status(400).json({
      message: 'Threshold must be a number between 0 and 1'
    });
  }

  if (reviewThreshold !== undefined && (typeof reviewThreshold !== 'number' || reviewThreshold < 0 || reviewThreshold > 1)) {
    return res.status(400).json({
      message: 'Review threshold must be a number between 0 and 1'
    });
  }

  if (mlReviewThreshold !== undefined && (typeof mlReviewThreshold !== 'number' || mlReviewThreshold < 0 || mlReviewThreshold > 1)) {
    return res.status(400).json({ message: 'Model review cutoff must be a number between 0 and 1' });
  }
  if (threshold === undefined && reviewThreshold === undefined && mlReviewThreshold === undefined) {
    return res.status(400).json({ message: 'Provide at least one threshold to update' });
  }

  if (reviewThreshold !== undefined && threshold !== undefined && threshold < reviewThreshold) {
    return res.status(400).json({
      message: 'Duplicate threshold must be greater than or equal to the review threshold'
    });
  }

  const previousThreshold = getDuplicateThreshold();
  const previousReviewThreshold = getReviewThreshold();
  const previousMlReviewThreshold = getMlReviewScoreThreshold();
  try {
    await logAudit(req.user.id, 'ADMIN_UPDATE_DUPLICATE_THRESHOLDS', 'system_settings', null, {
      from: { threshold: previousThreshold, reviewThreshold: previousReviewThreshold, mlReviewThreshold: previousMlReviewThreshold },
      to: {
        threshold: threshold ?? previousThreshold,
        reviewThreshold: reviewThreshold ?? previousReviewThreshold,
        mlReviewThreshold: mlReviewThreshold ?? previousMlReviewThreshold,
      },
    });
  } catch (error) { return next(error); }

  if (threshold !== undefined) setDuplicateThreshold(threshold);
  if (reviewThreshold !== undefined) setReviewThreshold(reviewThreshold);
  if (mlReviewThreshold !== undefined) setMlReviewScoreThreshold(mlReviewThreshold);

  res.json({
    message: 'Duplicate review settings updated successfully',
    threshold: getDuplicateThreshold(),
    reviewThreshold: getReviewThreshold(),
    mlReviewThreshold: getMlReviewScoreThreshold(),
    scoreIsCalibratedProbability: false,
  });
}

module.exports = {
  getThreshold,
  updateThreshold,
};
