// Allow 10 student-record verification requests per client IP per 15-minute window.
// The counting itself lives in `rateLimitWindow`; each endpoint keeps its own budget.
const { createRateLimit } = require('./rateLimitWindow');

const verificationRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many requests. Try again later.',
});

module.exports = verificationRateLimit;
module.exports.reset = verificationRateLimit.reset;
