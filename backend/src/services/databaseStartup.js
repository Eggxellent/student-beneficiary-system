'use strict';

const REQUIRED_USER_COLUMNS = Object.freeze([
  'id',
  'full_name',
  'email',
  'password_hash',
  'role',
  'is_active',
]);

const AUTH_SCHEMA_QUERY = `
  SELECT current_database() AS database_name,
         to_regclass('public.users') IS NOT NULL AS users_exists,
         to_regclass('users') = to_regclass('public.users') AS users_resolve_to_public,
         ARRAY(
           SELECT required.column_name
           FROM unnest($1::text[]) AS required(column_name)
           WHERE NOT EXISTS (
             SELECT 1 FROM information_schema.columns AS actual
             WHERE actual.table_schema = 'public'
               AND actual.table_name = 'users'
               AND actual.column_name = required.column_name
           )
         ) AS missing_user_columns
`;

async function assertAuthenticationSchemaReady(query, { expectedDatabaseName } = {}) {
  if (typeof expectedDatabaseName !== 'string' || expectedDatabaseName.trim() === '') {
    throw new Error('Expected database name is required for startup validation.');
  }

  const result = await query(AUTH_SCHEMA_QUERY, [REQUIRED_USER_COLUMNS]);
  const row = Array.isArray(result?.rows) ? result.rows[0] : undefined;
  if (!row
      || row.database_name !== expectedDatabaseName
      || row.users_exists !== true
      || row.users_resolve_to_public !== true
      || !Array.isArray(row.missing_user_columns)
      || row.missing_user_columns.length !== 0) {
    throw new Error('The configured database does not have the required authentication schema.');
  }
  return true;
}

module.exports = { assertAuthenticationSchemaReady, AUTH_SCHEMA_QUERY, REQUIRED_USER_COLUMNS };
