// Allow 10 verification requests per client IP per 15-minute window.
// Counters are process-local, reset on restart, and are not shared across instances.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 10;
const MAX_TRACKED_IPS = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const requestsByIp = new Map();
let lastCleanup = 0;

function verificationRateLimit(req, res, next) {
  const now = Date.now();
  if (now - lastCleanup >= CLEANUP_INTERVAL_MS) {
    for (const [ip, state] of requestsByIp) {
      if (now - state.startedAt >= WINDOW_MS) requestsByIp.delete(ip);
    }
    lastCleanup = now;
  }

  // req.ip equals the direct socket address unless the operator configured
  // TRUST_PROXY_HOPS, in which case Express resolves the real client from the forwarded
  // headers. Forwarded headers are never trusted by default.
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  let state = requestsByIp.get(ip);

  if (!state && requestsByIp.size >= MAX_TRACKED_IPS) {
    return res.status(429).json({ message: 'Too many requests. Try again later.' });
  }

  if (!state || now - state.startedAt >= WINDOW_MS) {
    state = { startedAt: now, count: 0 };
    requestsByIp.set(ip, state);
  }

  if (state.count >= MAX_REQUESTS) {
    return res.status(429).json({ message: 'Too many requests. Try again later.' });
  }

  state.count += 1;
  next();
}

function resetVerificationRateLimit() {
  requestsByIp.clear();
  lastCleanup = 0;
}

module.exports = verificationRateLimit;
module.exports.reset = resetVerificationRateLimit;
