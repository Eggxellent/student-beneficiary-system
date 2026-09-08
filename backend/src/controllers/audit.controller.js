const pool = require('../config/db');

async function list(req, res, next) {
  try {
    const result = await pool.query(
      `SELECT
        a.id,
        a.action,
        a.table_name,
        a.record_id,
        a.created_at,
        u.full_name AS user_name,
        u.email AS user_email
       FROM audit_logs a
       LEFT JOIN users u ON a.user_id = u.id
       ORDER BY a.created_at DESC`
    );

    res.json(result.rows);
  } catch (error) {
    next(error);
  }
}

module.exports = { list };
