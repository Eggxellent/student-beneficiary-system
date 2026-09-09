const pool = require('../config/db');

async function create({ student_id, amount, disbursement_date, created_by }) {
  const { rows } = await pool.query(
    `INSERT INTO disbursements (student_id, amount, disbursement_date, created_by)
     VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4)
     RETURNING *`,
    [student_id, amount, disbursement_date || null, created_by]
  );
  return rows[0];
}

async function getAll() {
  const { rows } = await pool.query(
    `SELECT d.*, s.full_name AS student_name
     FROM disbursements d
     JOIN students s ON d.student_id = s.id
     ORDER BY d.created_at DESC`
  );
  return rows;
}

module.exports = { create, getAll };
