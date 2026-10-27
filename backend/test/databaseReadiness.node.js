'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  checkDatabaseReadiness,
  REQUIRED_TABLES,
} = require('../src/services/databaseReadiness');

function catalogRow(overrides = {}) {
  return {
    database_name: 'sbms_postgres',
    missing_tables: [],
    ...overrides,
  };
}

test('readiness requires every application table and the expected database', async () => {
  let calls = 0;
  const result = await checkDatabaseReadiness(async (_sql, values) => {
    calls += 1;
    assert.deepEqual(values, [REQUIRED_TABLES]);
    return { rows: [catalogRow()] };
  }, { expectedDatabaseName: 'sbms_postgres' });

  assert.equal(calls, 1);
  assert.deepEqual(result, { ready: true });
});

test('readiness is false when a required table is missing or shadowed', async () => {
  const result = await checkDatabaseReadiness(async () => ({
    rows: [catalogRow({ missing_tables: ['users', 'beneficiaries'] })],
  }), { expectedDatabaseName: 'sbms_postgres' });

  assert.deepEqual(result, { ready: false });
});

test('readiness is false for the wrong database', async () => {
  const result = await checkDatabaseReadiness(async () => ({
    rows: [catalogRow({ database_name: 'another_database' })],
  }), { expectedDatabaseName: 'sbms_postgres' });

  assert.deepEqual(result, { ready: false });
});

test('readiness is false when production has no expected database configured', async () => {
  const result = await checkDatabaseReadiness(async () => ({ rows: [catalogRow()] }), {
    expectedDatabaseName: '',
  });

  assert.deepEqual(result, { ready: false });
});

test('malformed catalog results fail closed', async () => {
  const result = await checkDatabaseReadiness(async () => ({ rows: [{}] }));
  assert.deepEqual(result, { ready: false });
});

test('database errors propagate to the route boundary for a generic 503', async () => {
  await assert.rejects(
    checkDatabaseReadiness(async () => { throw new Error('private database detail'); }),
    /private database detail/,
  );
});
