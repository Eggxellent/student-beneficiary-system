// Public application traffic is unauthenticated, so each endpoint gets its own per-IP budget.
// Submission is expensive (it runs duplicate screening against the whole register) and is capped
// tightly; tracking is cheap and only needs protection against code guessing.
const { createRateLimit } = require('./rateLimitWindow');

const applicationSubmissionRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many applications from this connection. Try again later.',
});

const applicationTrackingRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many tracking requests. Try again later.',
});

module.exports = applicationSubmissionRateLimit;
module.exports.reset = applicationSubmissionRateLimit.reset;
module.exports.tracking = applicationTrackingRateLimit;
module.exports.resetTracking = applicationTrackingRateLimit.reset;
