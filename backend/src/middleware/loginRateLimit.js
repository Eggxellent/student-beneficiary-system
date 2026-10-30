const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS = 10;
const MAX_TRACKED_IPS = 10_000;
const attemptsByIp = new Map();
let lastCleanup = 0;

function loginRateLimit(req, res, next) {
  const now = Date.now();
  if (now - lastCleanup > 60_000) {
    for (const [ip, state] of attemptsByIp) {
      if (now - state.startedAt >= WINDOW_MS) attemptsByIp.delete(ip);
    }
    lastCleanup = now;
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  let state = attemptsByIp.get(ip);
  if (!state && attemptsByIp.size >= MAX_TRACKED_IPS) {
    return res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' });
  }
  if (!state || now - state.startedAt >= WINDOW_MS) {
    state = { startedAt: now, count: 0 };
    attemptsByIp.set(ip, state);
  }
  if (state.count >= MAX_REQUESTS) {
    return res.status(429).json({ message: 'Too many sign-in attempts. Try again later.' });
  }
  state.count += 1;
  next();
}

function resetLoginRateLimit() {
  attemptsByIp.clear();
  lastCleanup = 0;
}

module.exports = loginRateLimit;
module.exports.reset = resetLoginRateLimit;
