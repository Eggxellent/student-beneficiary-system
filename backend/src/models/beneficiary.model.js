const pool = require('../config/db');

async function getAll() {
  const { rows } = await pool.query('SELECT * FROM beneficiaries ORDER BY id');
  return rows;
}

async function getById(id) {
  const { rows } = await pool.query('SELECT * FROM beneficiaries WHERE id = $1', [id]);
  return rows[0];
}

async function create({ name, school, grade_level, scholarship_amount }) {
  const { rows } = await pool.query(
    `INSERT INTO beneficiaries (name, school, grade_level, scholarship_amount)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, school, grade_level, scholarship_amount]
  );
  return rows[0];
}

async function update(id, { name, school, grade_level, scholarship_amount }) {
  const { rows } = await pool.query(
    `UPDATE beneficiaries
     SET name = $1, school = $2, grade_level = $3, scholarship_amount = $4
     WHERE id = $5 RETURNING *`,
    [name, school, grade_level, scholarship_amount, id]
  );
  return rows[0];
}

async function remove(id) {
  const { rows } = await pool.query('DELETE FROM beneficiaries WHERE id = $1 RETURNING *', [id]);
  return rows[0];
}

module.exports = { getAll, getById, create, update, remove };
