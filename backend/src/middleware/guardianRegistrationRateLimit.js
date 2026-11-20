// Five guardian registrations per client IP per hour. Registration is the only unauthenticated
// endpoint in the guardian surface, so it gets its own counter instead of sharing the sign-in one.
const { createRateLimit } = require('./rateLimitWindow');

const guardianRegistrationRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
  message: 'Too many registration attempts. Try again later.',
});

module.exports = guardianRegistrationRateLimit;
module.exports.reset = guardianRegistrationRateLimit.reset;
