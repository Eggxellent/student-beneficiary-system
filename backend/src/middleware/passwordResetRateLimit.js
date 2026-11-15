// A reset link is a bearer credential, so the public endpoints that check and spend it get their own
// budget instead of sharing the sign-in counter: 10 attempts per client IP per 15 minutes.
const { createRateLimit } = require('./rateLimitWindow');

const passwordResetRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many password reset attempts. Try again later.',
});

module.exports = passwordResetRateLimit;
module.exports.reset = passwordResetRateLimit.reset;
