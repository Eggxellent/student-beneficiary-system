const test = require('node:test');
const assert = require('node:assert/strict');
const QRCode = require('qrcode');
const studentModel = require('../src/models/student.model');
const { buildStudentVerificationUrl, getPublicAppOrigin } = require('../src/config/publicAppUrl');
const { verify } = require('../src/controllers/verification.controller');
const verificationRateLimit = require('../src/middleware/verificationRateLimit');

const TOKEN = 'a'.repeat(64);
const originalHasQrToken = studentModel.hasQrToken;

test.after(() => {
  studentModel.hasQrToken = originalHasQrToken;
});

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

test('verification URL and QR image use the configured public origin and fragment token', async () => {
  const url = buildStudentVerificationUrl(TOKEN, 'https://sbms.example.ke', 'production');
  assert.equal(url, `https://sbms.example.ke/verify#token=${TOKEN}`);
  assert.equal(getPublicAppOrigin('http://localhost:4174', 'development'), 'http://localhost:4174');
  await assert.doesNotReject(async () => {
    const image = await QRCode.toDataURL(url);
    assert.match(image, /^data:image\/png;base64,/);
  });
  assert.throws(() => getPublicAppOrigin('http://localhost:4174', 'production'), /public HTTPS origin/);
});

test('verification looks up a well-formed token and returns only the existence result', async () => {
  let lookedUp;
  studentModel.hasQrToken = async (token) => { lookedUp = token; return true; };
  const res = responseRecorder();

  await verify({ body: { token: TOKEN } }, res);

  assert.equal(lookedUp, TOKEN);
  assert.deepEqual(res.body, { found: true });
});

test('verification rejects missing, malformed, and extra fields without querying', async () => {
  let lookups = 0;
  studentModel.hasQrToken = async () => { lookups += 1; return true; };
  const invalidBodies = [undefined, null, [], {}, { token: 'ABC' }, { token: TOKEN, student_id: 'private' }];

  for (const body of invalidBodies) {
    const res = responseRecorder();
    await verify({ body }, res);
    assert.deepEqual(res.body, { found: false });
  }
  assert.equal(lookups, 0);
});

test('verification returns a generic failure when its lookup fails', async () => {
  studentModel.hasQrToken = async () => { throw new Error('sensitive database detail'); };
  const res = responseRecorder();

  await verify({ body: { token: TOKEN } }, res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { error: 'temporarily_unavailable' });
  assert.equal(JSON.stringify(res.body).includes('sensitive'), false);
});

test('verification rate limiter allows ten requests and rejects the eleventh', () => {
  const ip = `198.51.100.${Math.floor(Math.random() * 200) + 20}`;
  let allowed = 0;
  let limited;
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };

  for (let index = 0; index < 11; index += 1) {
    verificationRateLimit({ socket: { remoteAddress: ip } }, res, () => { allowed += 1; });
    if (res.statusCode === 429) limited = res.body;
  }

  assert.equal(allowed, 10);
  assert.equal(res.statusCode, 429);
  assert.equal(limited.message, 'Too many requests. Try again later.');
});
