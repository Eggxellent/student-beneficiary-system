const pool = require('../config/db');

async function create({ user_id, action, table_name }) {
  await pool.query(
    `INSERT INTO audit_logs (user_id, action, table_name)
     VALUES ($1, $2, $3)`,
    [user_id, action, table_name]
  );
}

module.exports = { create };
