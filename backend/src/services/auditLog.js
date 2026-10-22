const pool = require('../config/db');

async function logAudit(userId, action, tableName, recordId, details = null, executor = pool) {
  await executor.query(
    `INSERT INTO audit_logs
      (user_id, action, table_name, record_id, details)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, action, tableName, recordId, details]
  );
}

module.exports = logAudit;
