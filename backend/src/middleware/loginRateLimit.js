// Allow 10 sign-in attempts per client IP per 15-minute window. The counting lives in
// `rateLimitWindow`; the message is specific so a refused sign-in is not confused with a refused
// QR scan.
const { createRateLimit } = require('./rateLimitWindow');

const loginRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 10,
  message: 'Too many sign-in attempts. Try again later.',
});

module.exports = loginRateLimit;
module.exports.reset = loginRateLimit.reset;
