'use strict';

/**
 * Provisions the disposable local verification database used by the guarded Jest
 * suites (`tests/testDatabaseGuard.js`) and the migration runner (`scripts/migrate.js`):
 * role `sbms_test_runner` plus database `sbms_test`.
 *
 * Safety rules enforced here:
 *  - the maintenance connection must be a loopback PostgreSQL URL for a superuser;
 *  - names are fixed, so no caller-supplied identifier is ever interpolated;
 *  - the run is additive: nothing is dropped, truncated, or rewritten;
 *  - an existing role keeps its current password, and an existing database is never
 *    altered beyond installing the required extension inside it;
 *  - the test password is read from the environment and never printed.
 *
 * Usage (from backend/, PowerShell):
 *   $env:SBMS_PROVISION_DATABASE_URL = '<local superuser URL>'
 *   $env:SBMS_TEST_DATABASE_PASSWORD = '<16+ character disposable password>'
 *   npm run db:provision-test
 */

const TEST_DATABASE = Object.freeze({ name: 'sbms_test', user: 'sbms_test_runner' });
const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MINIMUM_PASSWORD_LENGTH = 16;

function validateMaintenanceUrl(value) {
  if (!value) {
    throw new Error('Set SBMS_PROVISION_DATABASE_URL to a loopback superuser PostgreSQL URL.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SBMS_PROVISION_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
      || !LOCAL_DATABASE_HOSTS.has(hostname)
      || url.search
      || url.hash) {
    throw new Error('Refusing provisioning: only a loopback PostgreSQL URL is allowed, without query parameters.');
  }
  return url;
}

function validateTestPassword(value) {
  if (typeof value !== 'string' || value.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`Set SBMS_TEST_DATABASE_PASSWORD to at least ${MINIMUM_PASSWORD_LENGTH} characters; it is used only for the local ${TEST_DATABASE.user} role.`);
  }
  if (/[\s@/?#]/.test(value)) {
    throw new Error('The test password must not contain whitespace, "@", "/", "?" or "#" so it can be used in a URL unchanged.');
  }
  return value;
}


async function provisionTestDatabase({ adminConnectionString, testPassword } = {}) {
  validateMaintenanceUrl(adminConnectionString);
  validateTestPassword(testPassword);

  const { Client } = require('pg');
  const adminClient = new Client({ connectionString: adminConnectionString });
  const summary = { role: 'exists', database: 'exists', extension: 'present' };
  let targetClient;

  try {
    await adminClient.connect();
    const identity = await adminClient.query(
      "SELECT current_user AS role, current_database() AS database, current_setting('is_superuser') AS superuser",
    );
    if (identity.rows[0].superuser !== 'on') {
      throw new Error('Provisioning requires a superuser maintenance connection so the extension can be installed.');
    }

    const role = await adminClient.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [TEST_DATABASE.user]);
    if (role.rowCount === 0) {
      const statement = await adminClient.query(
        "SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
        [TEST_DATABASE.user, testPassword],
      );
      await adminClient.query(statement.rows[0].sql);
      summary.role = 'created';
    }

    const existingDatabase = await adminClient.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DATABASE.name]);
    if (existingDatabase.rowCount === 0) {
      const statement = await adminClient.query(
        "SELECT format('CREATE DATABASE %I OWNER %I', $1::text, $2::text) AS sql",
        [TEST_DATABASE.name, TEST_DATABASE.user],
      );
      await adminClient.query(statement.rows[0].sql);
      summary.database = 'created';
    }

    // schema.sql starts with CREATE EXTENSION IF NOT EXISTS pgcrypto. The guarded
    // bootstrap and Jest runs connect as the unprivileged test role, which cannot
    // install an extension, so it is installed once here by the superuser.
    const targetUrl = new URL(adminConnectionString);
    targetUrl.pathname = `/${TEST_DATABASE.name}`;
    targetClient = new Client({ connectionString: targetUrl.toString() });
    await targetClient.connect();
    const installed = await targetClient.query("SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'");
    if (installed.rowCount === 0) {
      await targetClient.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      summary.extension = 'created';
    }
    // Ownership normally grants this; the explicit grant keeps a pre-existing
    // database usable when it is owned by another role.
    await targetClient.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${TEST_DATABASE.user}`);

    return { ...summary, role_name: TEST_DATABASE.user, database_name: TEST_DATABASE.name };
  } finally {
    if (targetClient) await targetClient.end().catch(() => {});
    await adminClient.end().catch(() => {});
  }
}

if (require.main === module) {
  provisionTestDatabase({
    adminConnectionString: process.env.SBMS_PROVISION_DATABASE_URL,
    testPassword: process.env.SBMS_TEST_DATABASE_PASSWORD,
  })
    .then((summary) => {
      console.log(`Test database provisioning complete: role=${summary.role_name} (${summary.role}); database=${summary.database_name} (${summary.database}); pgcrypto=${summary.extension}.`);
      console.log(`Next: point DATABASE_URL and SBMS_TEST_DATABASE_URL at postgres://${TEST_DATABASE.user}:<password>@localhost:5432/${TEST_DATABASE.name}, then run the guarded bootstrap.`);
    })
    .catch((error) => {
      console.error(`Test database provisioning failed: ${error.message}`);
      process.exitCode = 1;
    });
}

module.exports = {
  provisionTestDatabase,
  validateMaintenanceUrl,
  validateTestPassword,
  TEST_DATABASE,
  MINIMUM_PASSWORD_LENGTH,
};
