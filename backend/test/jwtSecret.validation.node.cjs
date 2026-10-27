const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { test } = require('node:test');
const { validateJwtSecret } = require('../src/config/jwtSecret');

test('rejects a missing JWT secret without including a secret value in the error', () => {
  assert.throws(() => validateJwtSecret(undefined), {
    message: 'JWT_SECRET must contain at least 32 bytes and cannot be a placeholder.',
  });
});

test('rejects an empty JWT secret', () => {
  assert.throws(() => validateJwtSecret(''));
});

test('rejects a JWT secret shorter than 32 bytes', () => {
  assert.throws(() => validateJwtSecret('x'.repeat(31)));
});

test('rejects an obvious long placeholder', () => {
  const rejectedSecret = 'replace-with-a-long-random-secret';
  assert.throws(() => validateJwtSecret(rejectedSecret), (error) => {
    assert.equal(error.message, 'JWT_SECRET must contain at least 32 bytes and cannot be a placeholder.');
    assert.equal(error.message.includes(rejectedSecret), false);
    return true;
  });
});

test('accepts a secret generated from at least 32 cryptographically random bytes', () => {
  const secret = randomBytes(32).toString('hex');
  assert.equal(validateJwtSecret(secret), secret);
});
