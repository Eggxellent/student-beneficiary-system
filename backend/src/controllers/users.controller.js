const bcrypt = require('bcrypt');
const { z } = require('zod');
const pool = require('../config/db');

const createSchema = z.object({
  full_name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(255).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(72),
  role: z.enum(['admin', 'field_officer']),
});
const roleSchema = z.object({ role: z.enum(['admin', 'field_officer']) });
const rollbackResponse = Symbol('rollbackResponse');

function respondAfterRollback(status, body) {
  return { [rollbackResponse]: true, status, body };
}

async function runTransaction(work) {
  let client;
  let transactionStarted = false;
  let rollbackAttempted = false;
  let committed = false;
  let rolledBack = false;
  let result;
  let operationError;
  let discardReason;
  let cleanupError;

  try {
    client = await pool.connect();
    await client.query('BEGIN');
    transactionStarted = true;

    result = await work(client);
    if (result && result[rollbackResponse]) {
      rollbackAttempted = true;
      try {
        await client.query('ROLLBACK');
        transactionStarted = false;
        rolledBack = true;
      } catch (error) {
        discardReason = error;
        throw error;
      }
    } else {
      await client.query('COMMIT');
      transactionStarted = false;
      committed = true;
    }
  } catch (error) {
    operationError = error;
    if (client && transactionStarted && !rollbackAttempted) {
      rollbackAttempted = true;
      try {
        await client.query('ROLLBACK');
        transactionStarted = false;
        rolledBack = true;
      } catch (rollbackError) {
        discardReason = rollbackError;
        transactionStarted = false;
        // Preserve the operation failure; the shared handler returns a generic response.
      }
    }
  } finally {
    if (client) {
      try {
        client.release(discardReason);
      } catch (releaseError) {
        cleanupError = releaseError;
      }
    }
  }

  if (operationError) throw operationError;
  if (cleanupError) {
    if (committed || rolledBack) {
      console.error('Database client cleanup failed after transaction outcome was confirmed');
    } else {
      throw cleanupError;
    }
  }
  return result;
}

async function list(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT id, full_name, email, role, created_at FROM users WHERE is_active = TRUE ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Provide a name, valid email, password (8+ characters), and supported role.' });

  try {
    const { full_name, email, password, role } = parsed.data;
    const password_hash = await bcrypt.hash(password, 12);
    const createdUser = await runTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO users (full_name, email, password_hash, role)
         VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, role, created_at`,
        [full_name, email, password_hash, role]
      );
      await client.query(
        `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
         VALUES ($1, 'ADMIN_CREATE_USER', 'users', $2, $3)`,
        [req.user.id, rows[0].id, { role }]
      );
      return rows[0];
    });
    return res.status(201).json(createdUser);
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ message: 'That email address is already in use.' });
    next(error);
  }
}

async function updateRole(req, res, next) {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose either admin or field_officer.' });
  const { role } = parsed.data;
  try {
    const outcome = await runTransaction(async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(8831, 7745)');
      const target = await client.query('SELECT id, role FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE', [req.params.id]);
      if (!target.rows.length) {
        return respondAfterRollback(404, { message: 'User not found.' });
      }
      const priorRole = target.rows[0].role;
      if (target.rows[0].id === req.user.id && priorRole === 'admin' && role !== 'admin') {
        return respondAfterRollback(409, { message: 'You cannot remove your own administrator role.' });
      }
      if (priorRole === 'admin' && role !== 'admin') {
        const { rows } = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin' AND is_active = TRUE");
        if (rows[0].count <= 1) {
          return respondAfterRollback(409, { message: 'The last administrator role cannot be removed.' });
        }
      }
      const { rows } = await client.query(
        'UPDATE users SET role = $1 WHERE id = $2 RETURNING id, full_name, email, role, created_at',
        [role, req.params.id]
      );
      await client.query(
        `INSERT INTO audit_logs (user_id, action, table_name, record_id, details)
         VALUES ($1, 'ADMIN_CHANGE_USER_ROLE', 'users', $2, $3)`,
        [req.user.id, req.params.id, { from: priorRole, to: role }]
      );
      return { user: rows[0] };
    });
    if (outcome && outcome[rollbackResponse]) {
      return res.status(outcome.status).json(outcome.body);
    }
    return res.json(outcome.user);
  } catch (error) { next(error); }
}

module.exports = { list, create, updateRole };
