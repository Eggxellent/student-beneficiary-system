const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { listMigrationFiles, parseAdoptionList, validateTargetDatabaseUrl, MIGRATION_ORDER, MANUAL_MIGRATIONS } = require('../scripts/migrate');

test('migration target accepts only the local approved test database identity', () => {
  const url = 'postgresql://sbms_test_runner:local-only@localhost:5432/sbms_test';
  assert.equal(validateTargetDatabaseUrl(url).pathname, '/sbms_test');
  assert.throws(() => validateTargetDatabaseUrl('postgresql://sbms_test_runner:pw@db.example.com/sbms_test'), /only the local sbms_test database/);
  assert.throws(() => validateTargetDatabaseUrl('postgresql://other:pw@localhost/sbms_test'), /only the local sbms_test database/);
  assert.throws(() => validateTargetDatabaseUrl('postgresql://sbms_test_runner:pw@localhost/student_beneficiary_system'), /only the local sbms_test database/);
});

test('migration inventory is explicit and dependency ordered, with account policy held for review', () => {
  const files = listMigrationFiles();
  const automatic = files.filter((item) => !item.manual).map((item) => item.name);
  assert.deepEqual(automatic, [...MIGRATION_ORDER]);
  assert.deepEqual(files.filter((item) => item.manual).map((item) => item.name), [...MANUAL_MIGRATIONS]);
  assert.ok(automatic.indexOf('20261019_synthetic_student_marker.sql') < automatic.indexOf('20261019_limit_synthetic_schools.sql'));
  assert.ok(automatic.indexOf('20261019_field_officer_registration.sql') < automatic.indexOf('20261019_standardize_student_records.sql'));
  assert.ok(!automatic.includes('20261022_ml_duplicate_provenance.down.sql'));
});

test('ledger adoption accepts only explicit known migration names', () => {
  const files = listMigrationFiles();
  assert.deepEqual(parseAdoptionList('none', files), []);
  assert.deepEqual(parseAdoptionList(`${MIGRATION_ORDER[0]},${MANUAL_MIGRATIONS[0]}`, files), [MIGRATION_ORDER[0], MANUAL_MIGRATIONS[0]]);
  assert.throws(() => parseAdoptionList('unknown.sql', files), /unknown migration name/);
  assert.throws(() => parseAdoptionList(`${MIGRATION_ORDER[0]},${MIGRATION_ORDER[0]}`, files), /repeated/);
});

test('award reconciliation migration delegates transaction ownership to the runner', () => {
  const file = path.join(__dirname, '..', 'src', 'db', 'migrations', '20261023_bursary_award_reconciliation.sql');
  const sql = fs.readFileSync(file, 'utf8');
  assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT)\s*;/im);
});
