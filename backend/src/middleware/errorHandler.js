function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  // Keep internal messages, query text, and stack traces out of logs and API responses.
  console.error('Request failed');

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = status >= 500
    ? 'Internal server error'
    : (err.type === 'entity.too.large' ? 'Request body is too large' : 'Invalid request');

  res.status(status).json({ message });
}

module.exports = errorHandler;
