'use strict';

const REQUIRED_TABLES = Object.freeze([
  'users',
  'students',
  'beneficiaries',
  'duplicate_flags',
  'duplicate_review_events',
  'disbursements',
  'audit_logs',
  'reports',
  'bursary_awards',
  'bursary_award_verification_events',
  'disbursement_reconciliation_events',
]);

const READINESS_QUERY = `
  WITH expected(name) AS (
    SELECT unnest($1::text[])
  ), resolved AS (
    SELECT name,
           to_regclass(format('public.%I', name)) AS public_relation,
           to_regclass(format('%I', name)) AS resolved_relation
    FROM expected
  )
  SELECT current_database() AS database_name,
         ARRAY(
           SELECT resolved.name
           FROM resolved
           LEFT JOIN pg_class ON pg_class.oid = resolved.public_relation::oid
           WHERE resolved.public_relation IS NULL
              OR resolved.resolved_relation IS DISTINCT FROM resolved.public_relation
              OR pg_class.oid IS NULL
              OR pg_class.relkind NOT IN ('r', 'p')
           ORDER BY resolved.name
         ) AS missing_tables
`;

function readinessFromRow(row, expectedDatabaseName) {
  if (!row || typeof row.database_name !== 'string' || !Array.isArray(row.missing_tables)) {
    return false;
  }
  if (expectedDatabaseName === '' || (expectedDatabaseName && row.database_name !== expectedDatabaseName)) {
    return false;
  }
  return row.missing_tables.length === 0;
}

async function checkDatabaseReadiness(query, { expectedDatabaseName } = {}) {
  const result = await query(READINESS_QUERY, [REQUIRED_TABLES]);
  const row = Array.isArray(result?.rows) ? result.rows[0] : undefined;
  return { ready: readinessFromRow(row, expectedDatabaseName) };
}

module.exports = { checkDatabaseReadiness, READINESS_QUERY, REQUIRED_TABLES };
