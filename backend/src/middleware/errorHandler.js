const SAFE_ERROR_NAMES = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'DatabaseError',
  'JsonWebTokenError',
  'TokenExpiredError',
]);

function safeRead(object, key) {
  try {
    return object == null ? undefined : object[key];
  } catch {
    return undefined;
  }
}

function getAdminLoginDiagnostic(err) {
  const rawName = safeRead(err, 'name');
  const diagnostic = {
    errorName: typeof rawName === 'string' && SAFE_ERROR_NAMES.has(rawName) ? rawName : 'Error',
  };

  const code = safeRead(err, 'code');
  if (typeof code === 'string' && /^[A-Z0-9]{5}$/.test(code)) {
    diagnostic.postgresCode = code;
  }

  const stack = safeRead(err, 'stack');
  if (typeof stack === 'string') {
    for (const frame of stack.split('\n')) {
      const location = frame.trim().match(
        /^(?:at\s+.*?\s+\()?[^()\r\n]*[\\/]src[\\/](?:[A-Za-z0-9_.-]+[\\/])*([A-Za-z0-9_.-]+\.js):(\d+):(\d+)\)?$/
      );
      if (location) {
        diagnostic.location = `${location[1]}:${location[2]}:${location[3]}`;
        break;
      }
    }
  }

  return diagnostic;
}

function isAdminLoginRequest(req) {
  const originalUrl = safeRead(req, 'originalUrl');
  const path = typeof originalUrl === 'string'
    ? originalUrl.split('?')[0]
    : safeRead(req, 'path');
  return safeRead(req, 'method') === 'POST'
    && path === '/api/auth/login/admin';
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Temporary: remove or reduce this route-scoped diagnostic after the production cause is identified.
  // Log only allowlisted metadata for admin login; never log the error or raw stack.
  if (isAdminLoginRequest(req)) {
    console.error('Admin login failed', getAdminLoginDiagnostic(err));
  } else {
    console.error('Request failed');
  }

  const rawStatus = safeRead(err, 'status');
  const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500;
  const rawType = safeRead(err, 'type');
  const message = status >= 500
    ? 'Internal server error'
    : (rawType === 'entity.too.large' ? 'Request body is too large' : 'Invalid request');

  res.status(status).json({ message });
}

module.exports = errorHandler;
