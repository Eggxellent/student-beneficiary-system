'use strict';

const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Diagnostic could not start: DATABASE_URL is not configured.');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString });
  let connected = false;
  let transactionStarted = false;

  try {
    await client.connect();
    connected = true;
    await client.query('BEGIN TRANSACTION READ ONLY');
    transactionStarted = true;

    const database = await client.query('SELECT current_database() AS name');
    console.log(`Database: ${database.rows[0].name}`);

    const tables = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);
    console.log('Public tables:');
    for (const row of tables.rows) console.log(`- ${row.table_name}`);

    const ledgerCheck = await client.query(
      "SELECT to_regclass('public.sbms_schema_migrations') IS NOT NULL AS exists",
    );
    const ledgerExists = ledgerCheck.rows[0].exists;
    console.log(`Migration ledger exists: ${ledgerExists ? 'yes' : 'no'}`);

    if (ledgerExists) {
      const migrations = await client.query(
        'SELECT name, applied_at FROM public.sbms_schema_migrations ORDER BY name',
      );
      console.log('Migration records:');
      for (const row of migrations.rows) {
        console.log(`- ${row.name} (applied_at: ${row.applied_at})`);
      }
    }

    await client.query('ROLLBACK');
    transactionStarted = false;
  } catch {
    console.error('Diagnostic failed; database details withheld. No migration was run.');
    process.exitCode = 1;
  } finally {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        console.error('Read-only transaction cleanup failed; database details withheld.');
        process.exitCode = 1;
      }
    }
    if (connected) {
      try {
        await client.end();
      } catch {
        console.error('Database connection cleanup failed; details withheld.');
        process.exitCode = 1;
      }
    }
  }
}

main().catch(() => {
  console.error('Diagnostic failed; database details withheld. No migration was run.');
  process.exitCode = 1;
});
