const pool = require('../config/db');

async function findByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, full_name, email, password_hash, role, is_active FROM users WHERE email = $1',
    [email]
  );
  return rows[0];
}

async function createUser({ full_name, email, password_hash, role }) {
  const { rows } = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, role)
     VALUES ($1, $2, $3, $4)
     RETURNING id, full_name, email, role, created_at`,
    [full_name, email, password_hash, role]
  );
  return rows[0];
}

module.exports = { findByEmail, createUser };
