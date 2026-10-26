function getAllowedOrigins({ nodeEnv = process.env.NODE_ENV, corsOrigins = process.env.CORS_ORIGINS } = {}) {
  const configuredOrigins = corsOrigins === undefined
    ? (nodeEnv === 'production' ? '' : 'http://localhost:4174')
    : corsOrigins;
  if (typeof configuredOrigins !== 'string') {
    throw new Error('CORS_ORIGINS must be a comma-separated string of HTTP or HTTPS origins');
  }
  const values = configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  const origins = values.map((origin) => {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS must contain valid HTTP or HTTPS origins');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain valid HTTP or HTTPS origins without paths');
    }
    return parsed.origin;
  });
  return new Set(origins);
}

module.exports = { getAllowedOrigins };
