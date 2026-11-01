// Shared fixed-window, per-client-IP request counter for the unauthenticated endpoints.
//
// Each caller owns its own counter map, so exhausting the certificate budget cannot refuse a
// student-record scan (and the reverse). Counters are process-local: they reset on restart and are
// not shared between instances, which is recorded as a limitation in the test report.
const CLEANUP_INTERVAL_MS = 60 * 1000;
const MAX_TRACKED_IPS = 10_000;

function createRateLimit({ windowMs, maxRequests, message }) {
  const requestsByIp = new Map();
  let lastCleanup = 0;

  function rateLimit(req, res, next) {
    const now = Date.now();
    if (now - lastCleanup >= CLEANUP_INTERVAL_MS) {
      for (const [ip, state] of requestsByIp) {
        if (now - state.startedAt >= windowMs) requestsByIp.delete(ip);
      }
      lastCleanup = now;
    }

    // req.ip equals the direct socket address unless the operator configured
    // TRUST_PROXY_HOPS, in which case Express resolves the real client from the forwarded
    // headers. Forwarded headers are never trusted by default.
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let state = requestsByIp.get(ip);

    if (!state && requestsByIp.size >= MAX_TRACKED_IPS) {
      return res.status(429).json({ message });
    }

    if (!state || now - state.startedAt >= windowMs) {
      state = { startedAt: now, count: 0 };
      requestsByIp.set(ip, state);
    }

    if (state.count >= maxRequests) {
      return res.status(429).json({ message });
    }

    state.count += 1;
    next();
  }

  rateLimit.reset = function resetRateLimit() {
    requestsByIp.clear();
    lastCleanup = 0;
  };

  return rateLimit;
}

module.exports = { createRateLimit };
