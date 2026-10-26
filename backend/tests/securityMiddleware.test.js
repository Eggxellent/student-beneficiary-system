const express = require('express');
const request = require('supertest');
const { getAllowedOrigins } = require('../src/config/cors');
const errorHandler = require('../src/middleware/errorHandler');

const previousCorsOrigins = process.env.CORS_ORIGINS;
process.env.CORS_ORIGINS = 'http://localhost:4174';
const app = require('../src/index');
if (previousCorsOrigins === undefined) delete process.env.CORS_ORIGINS;
else process.env.CORS_ORIGINS = previousCorsOrigins;

describe('security middleware', () => {
  test('uses a local development default and fails closed for missing production config', () => {
    expect([...getAllowedOrigins({ nodeEnv: 'development', corsOrigins: undefined })])
      .toEqual(['http://localhost:4174']);
    expect([...getAllowedOrigins({ nodeEnv: 'production', corsOrigins: undefined })]).toEqual([]);
    expect([...getAllowedOrigins({ nodeEnv: 'production', corsOrigins: '' })]).toEqual([]);
  });

  test('accepts a comma-separated list of origins and rejects malformed values', () => {
    expect([...getAllowedOrigins({ corsOrigins: 'https://sbms.example, https://admin.example' })])
      .toEqual(['https://sbms.example', 'https://admin.example']);
    expect(() => getAllowedOrigins({ corsOrigins: 'https://sbms.example/path' })).toThrow(/valid HTTP or HTTPS origins/);
    expect(() => getAllowedOrigins({ corsOrigins: 'ftp://sbms.example' })).toThrow(/valid HTTP or HTTPS origins/);
    expect(() => getAllowedOrigins({ corsOrigins: null })).toThrow(/comma-separated string/);
  });

  test('returns security headers and allows the configured browser origin', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:4174');

    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:4174');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['permissions-policy']).toContain('microphone=()');
    expect(response.headers['permissions-policy']).not.toContain('camera=()');
  });

  test('handles trusted CORS preflight and rejects untrusted preflight', async () => {
    const allowed = await request(app)
      .options('/api/auth/login/admin')
      .set('Origin', 'http://localhost:4174')
      .set('Access-Control-Request-Method', 'POST');
    expect(allowed.status).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:4174');

    const rejected = await request(app)
      .options('/api/auth/login/admin')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(rejected.status).toBe(403);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('rejects untrusted browser origins before route handling and accepts requests without Origin', async () => {
    const rejected = await request(app)
      .get('/api/health')
      .set('Origin', 'https://untrusted.example');
    expect(rejected.status).toBe(403);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
    expect(rejected.body).toEqual({ message: 'Origin is not allowed' });

    const nonBrowser = await request(app).get('/api/health');
    expect(nonBrowser.status).toBe(200);
    expect(nonBrowser.headers['access-control-allow-origin']).toBeUndefined();
  });

  test('rejects oversized JSON with a safe client error before reaching login handling', async () => {
    const payload = JSON.stringify({ value: 'x'.repeat(101 * 1024) });
    const response = await request(app)
      .post('/api/auth/login/admin')
      .set('Origin', 'http://localhost:4174')
      .set('Content-Type', 'application/json')
      .send(payload);

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ message: 'Request body is too large' });
    expect(JSON.stringify(response.body)).not.toMatch(/stack|entity\.too\.large/i);
  });

  test('accepts small JSON bodies and returns a safe error for malformed JSON', async () => {
    const validBody = await request(app)
      .post('/api/auth/login/admin')
      .set('Content-Type', 'application/json')
      .send({ email: 'invalid', password: 'x' });
    expect(validBody.status).toBe(400);
    expect(validBody.body.error).toBe('Email and password are required');

    const malformedBody = await request(app)
      .post('/api/auth/login/admin')
      .set('Content-Type', 'application/json')
      .send('{"password":');
    expect(malformedBody.status).toBe(400);
    expect(malformedBody.body.message).toBe('Invalid request');
    expect(JSON.stringify(malformedBody.body)).not.toMatch(/syntaxerror|json|stack/i);
  });

  test('does not return or log exception messages or stack traces', (done) => {
    const testApp = express();
    const internalMessage = 'sensitive database details and beneficiary contents';
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    testApp.get('/failure', (req, res, next) => next(new Error(internalMessage)));
    testApp.use(errorHandler);

    request(testApp).get('/failure').then((response) => {
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ message: 'Internal server error' });
      expect(JSON.stringify(response.body)).not.toContain(internalMessage);
      expect(log).toHaveBeenCalledWith('Request failed');
      expect(JSON.stringify(log.mock.calls)).not.toContain(internalMessage);
      log.mockRestore();
      done();
    }).catch((error) => {
      log.mockRestore();
      done(error);
    });
  });

  test('attaches the request limiter to both sign-in routes without requiring a database', async () => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await request(app).post('/api/auth/login/admin').send({});
      expect(response.status).toBe(400);
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request(app).post('/api/auth/login/field-officer').send({});
      expect(response.status).toBe(400);
    }
    const limited = await request(app).post('/api/auth/login/admin').send({});
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ message: 'Too many sign-in attempts. Try again later.' });
  });
});
