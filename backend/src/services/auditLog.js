const pool = require('../config/db');

async function logAudit(userId, action, tableName, recordId) {
  await pool.query(
    `INSERT INTO audit_logs
      (user_id, action, table_name, record_id)
     VALUES ($1, $2, $3, $4)`,
    [userId, action, tableName, recordId]
  );
}

module.exports = logAudit;
