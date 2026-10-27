const MINIMUM_SECRET_BYTES = 32;
const INVALID_SECRET_MESSAGE = 'JWT_SECRET must contain at least 32 bytes and cannot be a placeholder.';

function validateJwtSecret(secret) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error(INVALID_SECRET_MESSAGE);
  }

  const normalized = secret.toLowerCase().replace(/[^a-z0-9]/g, '');
  const containsPlaceholder = [
    'replacewith',
    'changeme',
    'yourjwtsecret',
    'placeholder',
    'example',
    'password',
  ].some((value) => normalized.includes(value));

  if (containsPlaceholder || new Set(secret).size < 8) {
    throw new Error(INVALID_SECRET_MESSAGE);
  }

  return secret;
}

let configuredSecret;

function configureJwtSecret(secret) {
  configuredSecret = validateJwtSecret(secret);
  return configuredSecret;
}

function getJwtSecret() {
  if (configuredSecret) return configuredSecret;
  return configureJwtSecret(process.env.JWT_SECRET);
}

module.exports = { configureJwtSecret, getJwtSecret, validateJwtSecret };
