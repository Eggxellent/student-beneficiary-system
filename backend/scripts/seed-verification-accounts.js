// Create (or refresh) the two accounts the browser smoke check signs in with.
//
// Credentials come from the environment so no password is ever committed:
//   SBMS_VERIFY_PASSWORD          required, shared by both accounts
//   SBMS_VERIFY_ADMIN_EMAIL       default phase3.admin@example.invalid
//   SBMS_VERIFY_OFFICER_EMAIL     default phase3.officer@example.invalid
//
// Refuses to run unless DATABASE_URL points at a loopback test database, because it
// writes user rows.
const bcrypt = require('bcrypt');
const pool = require('../src/config/db');

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function targetDatabase() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL must be set to a loopback test database.');
  const parsed = new URL(raw);
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!LOCAL_HOSTS.has(host)) throw new Error(`Refusing to seed accounts on non-local host: ${host}`);
  return decodeURIComponent(parsed.pathname.slice(1));
}

async function main() {
  const database = targetDatabase();
  const password = process.env.SBMS_VERIFY_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error('SBMS_VERIFY_PASSWORD must be set to at least 12 characters.');
  }
  const accounts = [
    { email: process.env.SBMS_VERIFY_ADMIN_EMAIL || 'phase3.admin@example.invalid', name: 'Verification Admin', role: 'admin' },
    { email: process.env.SBMS_VERIFY_OFFICER_EMAIL || 'phase3.officer@example.invalid', name: 'Verification Officer', role: 'field_officer' },
  ];
  const hash = await bcrypt.hash(password, 12);
  for (const account of accounts) {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [account.email]);
    if (existing.rows[0]) {
      await pool.query(
        'UPDATE users SET password_hash = $1, role = $2, is_active = true, full_name = $3 WHERE id = $4',
        [hash, account.role, account.name, existing.rows[0].id]
      );
      console.log(`updated ${account.email} (${account.role}) in ${database}`);
    } else {
      await pool.query(
        'INSERT INTO users (full_name, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, true)',
        [account.name, account.email, hash, account.role]
      );
      console.log(`created ${account.email} (${account.role}) in ${database}`);
    }
  }
}

main()
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(`ERROR ${error.message}`);
    await pool.end().catch(() => {});
    process.exit(1);
  });
