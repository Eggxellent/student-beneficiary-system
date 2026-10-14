const test = require('node:test');
const assert = require('node:assert/strict');

const baseUrl = process.env.API_URL || 'http://localhost:5000';
const credentials = {
  email: process.env.TEST_EMAIL || 'admin@sbms.com',
  password: process.env.TEST_PASSWORD || 'Admin123!',
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const contentType = response.headers.get('content-type') || '';
  const body = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test('health endpoint is available', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(body, { status: 'ok' });
});

test('admin can authenticate, read admin resources, and is blocked from field workflows', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });

  assert.equal(login.response.status, 200);
  assert.ok(login.body.token);

  const headers = { authorization: `Bearer ${login.body.token}` };
  const [students, eligibility, disbursements, flags] = await Promise.all([
    request('/api/students', { headers }),
    request('/api/eligibility', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({}) }),
    request('/api/disbursements', { headers }),
    request('/api/duplicate-flags?status=pending', { headers }),
  ]);

  assert.equal(students.response.status, 403);
  assert.equal(eligibility.response.status, 403);
  assert.equal(disbursements.response.status, 200);
  assert.equal(flags.response.status, 200);
});

test('duplicate flagged student disbursement is blocked', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  assert.equal(login.response.status, 200);

  const response = await request('/api/disbursements', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${login.body.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      student_id: process.env.DUPLICATE_STUDENT_ID || '0bcb3ec5-c744-4318-9071-4b8bd139c400',
      amount: 15000,
    }),
  });

  assert.equal(response.response.status, 409);
  assert.match(response.body.message, /duplicate issue/i);
});

test('report export validates its date range', async () => {
  const login = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(credentials),
  });
  assert.equal(login.response.status, 200);

  const response = await request('/api/reports/export?start_date=2026-09-10&end_date=2026-09-09', {
    headers: { authorization: `Bearer ${login.body.token}` },
  });

  assert.equal(response.response.status, 400);
  assert.match(response.body.message, /cannot be after/i);
});
