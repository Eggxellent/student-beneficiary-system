const pool = require('../config/db');

async function create({ full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number }) {
  const { rows } = await pool.query(
    `INSERT INTO students (full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [full_name, date_of_birth || null, school_code || null, guardian_id || null, upi || null, birth_certificate_number || null]
  );
  return rows[0];
}

async function getById(id) {
  const { rows } = await pool.query('SELECT * FROM students WHERE id = $1', [id]);
  return rows[0];
}

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM students ORDER BY created_at DESC');
  return rows;
}

module.exports = { create, getById, getAll };
