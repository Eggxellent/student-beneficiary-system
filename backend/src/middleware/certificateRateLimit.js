// Allow 20 certificate verification requests per client IP per 15-minute window.
//
// A certificate check is the one public action a school, guardian or employer performs, and a
// single certificate is often checked while comparing a batch of printed documents, so the budget
// is deliberately separate from - and twice - the student-record budget in
// `verificationRateLimit`. A busy certificate scanner therefore cannot lock a school out of
// student-record verification.
const { createRateLimit } = require('./rateLimitWindow');

const certificateRateLimit = createRateLimit({
  windowMs: 15 * 60 * 1000,
  maxRequests: 20,
  message: 'Too many requests. Try again later.',
});

module.exports = certificateRateLimit;
module.exports.reset = certificateRateLimit.reset;
