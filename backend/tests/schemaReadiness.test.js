const pool = require('../src/config/db');
const { checkDatabaseReadiness, REQUIRED_TABLES } = require('../src/services/databaseReadiness');

// Regression guard for the defect where a database built from `schema.sql` plus the
// ordered migrations satisfied bootstrap's narrow users-column check but still failed
// GET /api/ready: the mounted /api/beneficiaries model queried a table that no SQL file
// created. These assertions run against the guarded local sbms_test database.
describe('Database schema readiness', () => {
  jest.setTimeout(30000);

  afterAll(async () => {
    await pool.end();
  });

  test('the readiness contract still lists every table the API depends on', () => {
    expect([...REQUIRED_TABLES].sort()).toEqual([
      'audit_logs',
      'beneficiaries',
      'bursary_award_verification_events',
      'bursary_awards',
      'disbursement_reconciliation_events',
      'disbursements',
      'duplicate_flags',
      'duplicate_review_events',
      'reports',
      'students',
      'users',
    ]);
  });

  test('checkDatabaseReadiness reports the built schema as ready', async () => {
    const { ready } = await checkDatabaseReadiness(
      (query, values) => pool.query(query, values),
      { expectedDatabaseName: undefined },
    );

    expect(ready).toBe(true);
  });

  test('the legacy beneficiaries table exists with the columns the model uses', async () => {
    const { rows } = await pool.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'beneficiaries'
        ORDER BY column_name`,
    );

    expect(rows.map((row) => row.column_name)).toEqual([
      'created_at',
      'grade_level',
      'id',
      'name',
      'scholarship_amount',
      'school',
    ]);
  });

  test('the mounted beneficiaries model query executes', async () => {
    const { rows } = await pool.query('SELECT * FROM beneficiaries ORDER BY id');

    expect(Array.isArray(rows)).toBe(true);
  });

  test('a beneficiaries row round-trips through the model contract', async () => {
    const inserted = await pool.query(
      `INSERT INTO beneficiaries (name, school, grade_level, scholarship_amount)
       VALUES ($1, $2, $3, $4) RETURNING id, name`,
      ['Readiness Probe', 'Nairobi School', 'Form 1', 0],
    );
    const row = inserted.rows[0];

    try {
      expect(row.name).toBe('Readiness Probe');
      const fetched = await pool.query('SELECT * FROM beneficiaries WHERE id = $1', [row.id]);
      expect(fetched.rows).toHaveLength(1);
    } finally {
      await pool.query('DELETE FROM beneficiaries WHERE id = $1', [row.id]);
    }
  });
});
