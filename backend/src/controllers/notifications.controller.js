const pool = require('../config/db');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const AWARDS_PATH = '/awards';

// The panel shows a handful of waiting students; `pending_approval_count` is what tells the
// administrator how many are actually in the queue, and the Awards page lists the rest.
const PENDING_APPROVALS_LIMIT = 5;

// Work that is still waiting cannot be "read" away. A proposal stays in `submitted` after the
// `award_submitted` row has been opened and deleted, so the pending list is derived from
// `bursary_awards` on every read instead of being a one-shot notification row.
const PENDING_APPROVALS_SQL = `
  SELECT a.id, s.full_name AS student_name, a.requested_amount, a.created_at
  FROM bursary_awards a
  JOIN students s ON s.id = a.student_id
  WHERE a.status = 'submitted'
  ORDER BY a.created_at ASC
  LIMIT $1`;

// Every statement below filters on `user_id = req.user.id`. That is the whole authorisation
// model: a notification row belongs to exactly one recipient, so a field officer cannot read an
// administrator's review queue by guessing an id, and the API does not depend on the frontend to
// hide anything.
//
// There is no read state. Reading a notification deletes it (see `dismiss`), so everything in the
// list is something the recipient has not opened yet, and the badge count is simply the number of
// rows this user owns.
//
// One exception: an administrator's pending queue. A proposer's `award_submitted` row disappears
// when it is opened, but the proposal it pointed at is still waiting for a decision. Those rows are
// therefore derived from `bursary_awards` on every read (`pending_approvals`) and are not deletable;
// they clear themselves when the award is decided, voided or otherwise leaves `submitted`.
async function list(req, res, next) {
  try {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const isAdmin = req.user?.role === 'admin';
    const [items, total, pending, pendingTotal] = await Promise.all([
      pool.query(
        `SELECT id, category, title, body, link, reference_id, created_at
         FROM notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [req.user.id, limit]
      ),
      pool.query('SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1', [req.user.id]),
      // A field officer proposed the award and already knows it is waiting, so the derived list is
      // administrator-only and costs them nothing.
      isAdmin
        ? pool.query(PENDING_APPROVALS_SQL, [PENDING_APPROVALS_LIMIT])
        : Promise.resolve({ rows: [] }),
      isAdmin
        ? pool.query("SELECT COUNT(*)::int AS count FROM bursary_awards WHERE status = 'submitted'")
        : Promise.resolve({ rows: [] }),
    ]);
    res.json({
      notifications: items.rows,
      unread_count: Number(total.rows[0]?.count || 0),
      // Students whose award is submitted and awaiting an administrator decision. `link` is added
      // here so the client treats them like any other row when navigating.
      pending_approvals: pending.rows.map((row) => ({ ...row, link: AWARDS_PATH })),
      pending_approval_count: Number(pendingTotal.rows[0]?.count || 0),
      limit,
    });
  } catch (error) {
    next(error);
  }
}

// Reading a notification removes it. A delete rather than a flag keeps the table small, makes the
// badge authoritative without a second query, and matches the only action the recipient can take.
async function dismiss(req, res, next) {
  if (!UUID_PATTERN.test(String(req.params.id || ''))) {
    return res.status(404).json({ message: 'Notification not found.' });
  }
  try {
    const { rows } = await pool.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    // A row owned by someone else is indistinguishable from a row that does not exist, so the
    // endpoint cannot be used to probe for notification ids.
    if (!rows.length) return res.status(404).json({ message: 'Notification not found.' });
    return res.json({ removed: rows[0].id });
  } catch (error) {
    return next(error);
  }
}

// "Clear all" is the same operation without picking an id. It cannot reach another user's rows
// because the delete is scoped the same way.
async function clearAll(req, res, next) {
  try {
    const { rowCount } = await pool.query('DELETE FROM notifications WHERE user_id = $1', [req.user.id]);
    return res.json({ removed: Number(rowCount || 0) });
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, dismiss, clearAll };

