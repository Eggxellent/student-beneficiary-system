const assert = require('node:assert/strict');
const { test } = require('node:test');
const errorHandler = require('../src/middleware/errorHandler');

function invokeErrorHandler({ err, method = 'POST', path = '/api/auth/login/admin', originalUrl }) {
  const result = { status: undefined, body: undefined, forwarded: undefined };
  const req = { method, path, originalUrl };
  const res = {
    headersSent: false,
    status(status) {
      result.status = status;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  const next = (error) => { result.forwarded = error; };
  errorHandler(err, req, res, next);
  return result;
}

async function captureErrorLog(run) {
  const originalError = console.error;
  const calls = [];
  console.error = (...args) => calls.push(args);
  try {
    const result = run();
    return { result, calls };
  } finally {
    console.error = originalError;
  }
}

test('admin login logs a fixed label and generic error name with a generic 500 response', async () => {
  const { result, calls } = await captureErrorLog(() => invokeErrorHandler({ err: new Error('private detail') }));
  assert.deepEqual(calls, [['Admin login failed', { errorName: 'Error' }]]);
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: 'Internal server error' });
});

test('admin login matches the original mounted request URL and ignores its query string', async () => {
  const { calls } = await captureErrorLog(() => invokeErrorHandler({
    err: new Error('private detail'),
    path: '/login/admin',
    originalUrl: '/api/auth/login/admin?source=web',
  }));
  assert.deepEqual(calls, [['Admin login failed', { errorName: 'Error' }]]);
});

test('admin login includes only a validated PostgreSQL-style error code', async () => {
  const error = Object.assign(new Error('relation not found'), { code: '42P01' });
  const { calls } = await captureErrorLog(() => invokeErrorHandler({ err: error }));
  assert.deepEqual(calls, [['Admin login failed', { errorName: 'Error', postgresCode: '42P01' }]]);
});

test('admin login parses a source location without logging sensitive message or raw stack', async () => {
  const error = new Error('password, email, connection string, beneficiary details');
  error.stack = [
    `${error.name}: ${error.message}`,
    '    at findByEmail (C:\\app\\backend\\src\\models\\auth.model.js:4:31)',
  ].join('\n');
  const { result, calls } = await captureErrorLog(() => invokeErrorHandler({ err: error }));
  assert.deepEqual(calls, [[
    'Admin login failed',
    { errorName: 'Error', location: 'auth.model.js:4:31' },
  ]]);
  assert.equal(result.body.message, 'Internal server error');
  assert.doesNotMatch(JSON.stringify(calls), /password|email|connection string|beneficiary|C:\\\\app/);
});

test('other routes retain the existing fixed generic log', async () => {
  const { result, calls } = await captureErrorLog(() => invokeErrorHandler({
    err: new Error('private detail'),
    path: '/api/students',
  }));
  assert.deepEqual(calls, [['Request failed']]);
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: 'Internal server error' });
});

test('nearby paths and other methods do not emit admin-login diagnostics', async () => {
  const { calls } = await captureErrorLog(() => {
    invokeErrorHandler({ err: new Error('private detail'), originalUrl: '/api/auth/login/admin/extra' });
    invokeErrorHandler({ err: new Error('private detail'), method: 'GET', originalUrl: '/api/auth/login/admin' });
  });
  assert.deepEqual(calls, [['Request failed'], ['Request failed']]);
});

test('malformed error properties cannot make the handler throw or leak details', async () => {
  const err = {};
  for (const property of ['name', 'code', 'stack', 'status', 'type']) {
    Object.defineProperty(err, property, { get() { throw new Error('must not escape'); } });
  }
  const { result, calls } = await captureErrorLog(() => invokeErrorHandler({ err }));
  assert.deepEqual(calls, [['Admin login failed', { errorName: 'Error' }]]);
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { message: 'Internal server error' });
});

test('unrecognized names and malformed database codes are reduced to safe defaults', async () => {
  const error = Object.assign(new Error('private detail'), {
    name: 'password-secret-value',
    code: '42p01',
  });
  const { calls } = await captureErrorLog(() => invokeErrorHandler({ err: error }));
  assert.deepEqual(calls, [['Admin login failed', { errorName: 'Error' }]]);
});
