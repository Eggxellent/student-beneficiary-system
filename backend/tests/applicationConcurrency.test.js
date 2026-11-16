const request = require('supertest');
const { randomInt } = require('crypto');
const app = require('../src/index');
const pool = require('../src/config/db');
const applicationRateLimit = require('../src/middleware/applicationRateLimit');
const { submissionLockKeys, applicationSchema } = require('../src/controllers/applications.controller');

// These suites test the submission guard, not the model: scoring is replaced with a score far below
// any review threshold so no duplicate case is opened and no student is created.
jest.mock('../src/services/mlDuplicateReview', () => {
  const actual = jest.requireActual('../src/services/mlDuplicateReview');
  return { ...actual, scorePairs: jest.fn() };
});
const { scorePairs } = require('../src/services/mlDuplicateReview');

const createdApplicationIds = [];

function uniquePhone() {
  return `0789${String(randomInt(0, 1000000)).padStart(6, '0')}`;
}

function validApplication(overrides = {}) {
  const suffix = `${Date.now()}${randomInt(1000, 9999)}`;
  return {
    full_name: 'Concurrency Test Child',
    date_of_birth: '2012-02-29',
    school_code: 'Nairobi School',
    guardian_name: 'Concurrency Test Guardian',
    guardian_phone: uniquePhone(),
    relationship_to_student: 'mother',
    upi: `UPI-CONC-${suffix}`,
    ...overrides,
  };
}

// The keys the controller will take, produced by the same schema and the same helper, so a test can
// hold the lock a request is about to need.
function lockKeysFor(body) {
  return submissionLockKeys(applicationSchema.parse(body));
}

// Holding the lock before both requests are issued makes the outcome deterministic: neither request
// can insert until the holder rolls back, and the first to proceed commits before the second can run
// its pre-check.
async function holdLocks(keys) {
  const client = await pool.connect();
  await client.query('BEGIN');
  for (const key of keys) {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  }
  return client;
}

async function submit(body) {
  const response = await request(app).post('/api/applications').send(body);
  if (response.body?.application?.id) createdApplicationIds.push(response.body.application.id);
  return response;
}

async function releaseAndAwait(holder, pending) {
  // Give both requests time to reach the lock, then let them through together.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await holder.query('ROLLBACK');
  return Promise.all(pending);
}

async function countBy(column, value) {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS total FROM student_applications WHERE ${column} = $1`,
    [value],
  );
  return rows[0].total;
}

beforeEach(() => {
  applicationRateLimit.reset();
  applicationRateLimit.resetTracking();
  scorePairs.mockReset();
  scorePairs.mockImplementation(async (pairs) => ({
    model_version: 'test-model',
    results: pairs.map(() => ({ score: 0.1, features: { full_name_similarity: 0.1 } })),
  }));
});

afterAll(async () => {
  if (createdApplicationIds.length) {
    await pool.query('DELETE FROM audit_logs WHERE table_name = $1 AND record_id = ANY($2::uuid[])', [
      'student_applications', createdApplicationIds,
    ]);
    await pool.query('DELETE FROM student_applications WHERE id = ANY($1::uuid[])', [createdApplicationIds]);
  }
  await pool.end();
});


describe('Application submission guard', () => {
  jest.setTimeout(60000);

  test('two simultaneous submissions of one child by one guardian create exactly one application', async () => {
    const body = validApplication();
    const holder = await holdLocks(lockKeysFor(body));
    let responses;
    try {
      responses = await releaseAndAwait(holder, [submit(body), submit(body)]);
    } finally {
      holder.release();
    }

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const rejected = responses.find((response) => response.status === 409);
    expect(rejected.body.code).toBe('APPLICATION_ALREADY_SUBMITTED');
    expect(await countBy('upi', body.upi)).toBe(1);
  });

  test('serialises one child submitted by two different guardians, and accepts only the first', async () => {
    const first = validApplication();
    const second = validApplication({
      // Same child, different phone: the guardian key alone cannot see this pair.
      guardian_phone: uniquePhone(),
      guardian_name: 'Second Guardian',
      full_name: first.full_name,
      date_of_birth: first.date_of_birth,
      school_code: first.school_code,
      upi: first.upi,
    });
    expect(lockKeysFor(first)).not.toEqual(lockKeysFor(second));

    const holder = await holdLocks([...new Set([...lockKeysFor(first), ...lockKeysFor(second)])]);
    let responses;
    try {
      responses = await releaseAndAwait(holder, [submit(first), submit(second)]);
    } finally {
      holder.release();
    }

    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const rejected = responses.find((response) => response.status === 409);
    expect(rejected.body.code).toBe('APPLICATION_ALREADY_SUBMITTED');
    expect(rejected.body.message).toContain('another guardian');
    expect(await countBy('upi', first.upi)).toBe(1);
  });

  test('different children are not serialised and both applications are accepted', async () => {
    const first = validApplication();
    const second = validApplication({
      full_name: 'Unrelated Concurrency Child',
      date_of_birth: '2013-08-04',
      guardian_phone: uniquePhone(),
    });
    expect(lockKeysFor(first).filter((key) => lockKeysFor(second).includes(key))).toEqual([]);

    const responses = await Promise.all([submit(first), submit(second)]);
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    expect(await countBy('upi', first.upi)).toBe(1);
    expect(await countBy('upi', second.upi)).toBe(1);
  });

  test('a shared name, date of birth and school serialises submissions without rejecting them', async () => {
    // Two children can share a name and a birthday. The composite key must order them, never decide
    // for them: only an identifier match may refuse a submission.
    const first = validApplication({ upi: undefined, birth_certificate_number: 'BC-CONC-1' });
    const second = validApplication({
      guardian_phone: uniquePhone(),
      upi: undefined,
      birth_certificate_number: 'BC-CONC-2',
    });
    expect(lockKeysFor(first).filter((key) => lockKeysFor(second).includes(key)))
      .toEqual([expect.stringContaining('name_dob_school')]);

    const holder = await holdLocks([...new Set([...lockKeysFor(first), ...lockKeysFor(second)])]);
    let responses;
    try {
      responses = await releaseAndAwait(holder, [submit(first), submit(second)]);
    } finally {
      holder.release();
    }

    responses.forEach((response) => expect(response.status).toBe(201));
    expect(await countBy('birth_certificate_number', first.birth_certificate_number)).toBe(1);
    expect(await countBy('birth_certificate_number', second.birth_certificate_number)).toBe(1);
  });

  test('a resubmission after the first has committed is refused by the pre-check, not by the lock', async () => {
    const body = validApplication();
    const accepted = await submit(body);
    expect(accepted.status).toBe(201);

    const repeated = await submit(body);
    expect(repeated.status).toBe(409);
    expect(repeated.body.code).toBe('APPLICATION_ALREADY_SUBMITTED');
    expect(await countBy('upi', body.upi)).toBe(1);
  });
});
