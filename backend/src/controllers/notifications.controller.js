const pool = require('../config/db');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// Every statement below filters on `user_id = req.user.id`. That is the whole authorisation
// model: a notification row belongs to exactly one recipient, so a field officer cannot read an
// administrator's review queue by guessing an id, and the API does not depend on the frontend to
// hide anything.
async function list(req, res, next) {
  try {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const [items, unread] = await Promise.all([
      pool.query(
        `SELECT id, category, title, body, link, reference_id, read_at, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.user.id, limit]
      ),
      pool.query(
        'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
        [req.user.id]
      ),
    ]);
    res.json({
      notifications: items.rows,
      unread_count: Number(unread.rows[0]?.count || 0),
      limit,
    });
  } catch (error) {
    next(error);
  }
}

async function markRead(req, res, next) {
  if (!UUID_PATTERN.test(String(req.params.id || ''))) {
    return res.status(404).json({ message: 'Notification not found.' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE notifications
       SET read_at = COALESCE(read_at, NOW())
       WHERE id = $1 AND user_id = $2
       RETURNING id, read_at`,
      [req.params.id, req.user.id]
    );
    // A row owned by someone else is indistinguishable from a row that does not exist, so the
    // endpoint cannot be used to probe for notification ids.
    if (!rows.length) return res.status(404).json({ message: 'Notification not found.' });
    return res.json({ notification: rows[0] });
  } catch (error) {
    return next(error);
  }
}

async function markAllRead(req, res, next) {
  try {
    const { rowCount } = await pool.query(
      'UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL',
      [req.user.id]
    );
    return res.json({ updated: Number(rowCount || 0) });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, markRead, markAllRead };
