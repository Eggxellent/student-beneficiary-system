'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  assertAuthenticationSchemaReady,
  REQUIRED_USER_COLUMNS,
} = require('../src/services/databaseStartup');

function row(overrides = {}) {
  return {
    database_name: 'sbms_test',
    users_exists: true,
    users_resolve_to_public: true,
    missing_user_columns: [],
    ...overrides,
  };
}

test('startup requires the expected database and a resolvable users table with login columns', async () => {
  let receivedValues;
  const ready = await assertAuthenticationSchemaReady(async (_sql, values) => {
    receivedValues = values;
    return { rows: [row()] };
  }, { expectedDatabaseName: 'sbms_test' });
  assert.equal(ready, true);
  assert.deepEqual(receivedValues, [REQUIRED_USER_COLUMNS]);
});

test('startup fails closed on wrong database, missing table, search-path shadowing, or missing columns', async (t) => {
  const badRows = [
    row({ database_name: 'another_database' }),
    row({ users_exists: false }),
    row({ users_resolve_to_public: false }),
    row({ missing_user_columns: ['is_active'] }),
    undefined,
  ];
  for (const badRow of badRows) {
    await t.test(JSON.stringify(badRow), async () => {
      await assert.rejects(
        assertAuthenticationSchemaReady(async () => ({ rows: [badRow] }), { expectedDatabaseName: 'sbms_test' }),
        /required authentication schema/,
      );
    });
  }
});

test('startup refuses to validate without an explicit expected database name', async () => {
  let queried = false;
  await assert.rejects(assertAuthenticationSchemaReady(async () => { queried = true; }, {}), /Expected database name/);
  assert.equal(queried, false);
});
