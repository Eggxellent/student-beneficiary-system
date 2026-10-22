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

async function list(req, res, next) {
  try {
    const { rows } = await pool.query('SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC');
    res.json(rows);
  } catch (error) { next(error); }
}

async function create(req, res, next) {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Provide a name, valid email, password (8+ characters), and supported role.' });
  const client = await pool.connect();
  try {
    const { full_name, email, password, role } = parsed.data;
    const password_hash = await bcrypt.hash(password, 12);
    await client.query('BEGIN');
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
    await client.query('COMMIT');
    res.status(201).json(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (error.code === '23505') return res.status(409).json({ message: 'That email address is already in use.' });
    next(error);
  } finally { client.release(); }
}

async function updateRole(req, res, next) {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Choose either admin or field_officer.' });
  const { role } = parsed.data;
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(8831, 7745)');
      const target = await client.query('SELECT id, role FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      if (!target.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'User not found.' });
      }
      const priorRole = target.rows[0].role;
      if (target.rows[0].id === req.user.id && priorRole === 'admin' && role !== 'admin') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'You cannot remove your own administrator role.' });
      }
      if (priorRole === 'admin' && role !== 'admin') {
        const { rows } = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'");
        if (rows[0].count <= 1) {
          await client.query('ROLLBACK');
          return res.status(409).json({ message: 'The last administrator role cannot be removed.' });
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
      await client.query('COMMIT');
      res.json(rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  } catch (error) { next(error); }
}

module.exports = { list, create, updateRole };
