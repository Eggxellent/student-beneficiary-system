const pool = require('../config/db');
const logAudit = require('../services/auditLog');

async function list(req, res, next) {
  try {
    const { status = 'pending' } = req.query;
    const result = await pool.query(
      `SELECT df.id, df.probability, df.status, df.created_at,
              s1.full_name AS student_name, s1.school_code AS student_school,
              s2.full_name AS matched_student_name, s2.school_code AS matched_school
       FROM duplicate_flags df
       JOIN students s1 ON df.student_id = s1.id
       JOIN students s2 ON df.matched_student_id = s2.id
       WHERE df.status = $1
       ORDER BY df.created_at DESC`,
      [status]
    );
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
}

async function update(req, res, next) {
  try {
    const { status } = req.body;
    if (!['confirmed_duplicate', 'cleared'].includes(status)) {
      return res.status(400).json({ message: 'Status must be confirmed_duplicate or cleared' });
    }

    const result = await pool.query(
      `UPDATE duplicate_flags
       SET status = $1, resolved_by = $2, resolved_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, req.user.id || req.user.sub, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ message: 'Duplicate flag not found' });

    const flag = result.rows[0];
    await logAudit(req.user.id || req.user.sub, 'RESOLVE_DUPLICATE', 'duplicate_flags', flag.id);
    res.json({ message: 'Duplicate flag updated successfully', flag });
  } catch (error) {
    next(error);
  }
}

module.exports = { list, update };
