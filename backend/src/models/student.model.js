const pool = require('../config/db');

async function create({ full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number, national_id_number, primary_phone, qr_token }, executor = pool) {
  const { rows } = await executor.query(
    `INSERT INTO students (full_name, date_of_birth, school_code, guardian_id, upi, birth_certificate_number, national_id_number, primary_phone, qr_token)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [full_name, date_of_birth || null, school_code || null, guardian_id || null, upi || null, birth_certificate_number || null, national_id_number || null, primary_phone || null, qr_token || null]
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
