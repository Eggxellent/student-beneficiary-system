// Create or repair the first administrator account in a fresh SBMS database.
//
// Why this exists: `POST /api/auth/register` answers 410 ("Public registration is disabled") and
// `backend/scripts/seed-verification-accounts.js` deliberately refuses any non-loopback database,
// so a brand-new Azure PostgreSQL instance has no way to produce its first admin. This script does
// exactly that and nothing else, reusing the backend's own `pg` and `bcrypt` dependencies so the
// password hash format matches what `loginAdmin` verifies.
//
// Usage (from the repository root):
//   $env:DATABASE_URL = "postgresql://user:pass@host:5432/sbms?sslmode=require"
//   $env:ADMIN_EMAIL  = "you@example.com"
//   $env:ADMIN_PASSWORD = "..."          # >= 12 chars recommended
//   node deploy/azure/create-admin.mjs
//
// Idempotent: re-running resets that account's password, promotes it to 'admin' and re-activates it.

import { createRequire } from 'node:module';

const require = createRequire(new URL('../../backend/package.json', import.meta.url));
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
const ADMIN_NAME = process.env.ADMIN_NAME || 'System Administrator';
const BCRYPT_ROUNDS = 10; // matches backend/src/controllers/auth* defaults

function fail(message) {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

if (!DATABASE_URL) fail('DATABASE_URL is not set.');
if (!ADMIN_EMAIL || !ADMIN_EMAIL.includes('@')) fail('ADMIN_EMAIL is not set or invalid.');
if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) fail('ADMIN_PASSWORD must be at least 12 characters.');

const host = (() => {
  try {
    return new URL(DATABASE_URL).host;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
})();

if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) && !process.env.ALLOW_LOCAL) {
  fail(`refusing to write an admin row to ${host} — set ALLOW_LOCAL=1 if that is really intended.`);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: /sslmode=require/.test(DATABASE_URL) ? { rejectUnauthorized: false } : false,
});

try {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_ROUNDS);
  const email = ADMIN_EMAIL.trim().toLowerCase();

  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role, is_active)
     VALUES ($1, $2, $3, 'admin', TRUE)
     ON CONFLICT (email) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           role = 'admin',
           is_active = TRUE
     RETURNING id, email, role, is_active`,
    [ADMIN_NAME, email, passwordHash],
  );

  console.log(`create-admin: ${rows[0].role} ready on ${host} -> ${rows[0].email} (id ${rows[0].id})`);
} catch (error) {
  // PGRST-ish errors from `pg` carry a `code`; surface the actionable ones plainly.
  if (error.code === '42P01') fail('table "users" does not exist — run `npm run db:bootstrap-empty` first.');
  fail(error.message);
} finally {
  await pool.end();
}
