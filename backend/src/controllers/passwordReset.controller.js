// Password reset links. There is no outbound mail transport in this deployment, so an administrator
// issues the link from User Management and hands it to the account holder. The holder then chooses a
// new password. Three properties hold regardless of who is told the link:
//   * the database stores a SHA-256 of the token, never the token that was handed over;
//   * a link is single use (the token row is marked used in the same statement that saves the
//     password, so a replay finds nothing to consume);
//   * a link is short lived (RESET_TTL_MINUTES), and issuing a new one retires the previous one.
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const { z } = require('zod');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');

const RESET_TTL_MINUTES = 30;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const EXPIRED_MESSAGE = 'This password reset link is no longer valid. Ask an administrator for a new one.';

const completeSchema = z.object({
  token: z.string().trim().toLowerCase().regex(TOKEN_PATTERN),
  password: z.string().min(8).max(72),
});
const tokenSchema = z.object({
  token: z.string().trim().toLowerCase().regex(TOKEN_PATTERN),
});

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!domain) return email;
  return `${local.slice(0, 1)}${'*'.repeat(Math.max(local.length - 1, 2))}@${domain}`;
}

// Administrative issue: POST /api/users/:id/password-reset
async function issue(req, res, next) {
  const targetId = z.string().uuid().safeParse(req.params.id);
  if (!targetId.success) return res.status(400).json({ message: 'Choose an account to reset.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The same advisory lock the other administrator actions on users take, so an issue cannot
    // interleave with a role change or a deactivation of the same account.
    await client.query('SELECT pg_advisory_xact_lock(8831, 7745)');
    const target = await client.query(
      'SELECT id, full_name, email, role FROM users WHERE id = $1 AND is_active = TRUE FOR UPDATE',
      [targetId.data]
    );
    if (!target.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'User not found.' });
    }

    const user = target.rows[0];
    const token = crypto.randomBytes(32).toString('hex');
    // Retiring every unused link for this account means only the newest one works, so an older
    // copied link cannot be used after a fresh one is issued.
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );
    const issued = await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, issued_by, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::interval)
       RETURNING expires_at`,
      [user.id, hashToken(token), req.user.id, String(RESET_TTL_MINUTES)]
    );
    await logAudit(req.user.id, 'ADMIN_ISSUE_PASSWORD_RESET', 'users', user.id, {
      email: user.email,
      expires_at: issued.rows[0].expires_at,
    }, client);
    await client.query('COMMIT');

    res.status(201).json({
      message: `Password reset link issued for ${user.full_name}. Hand it over directly; it expires in ${RESET_TTL_MINUTES} minutes and works once.`,
      token,
      reset_path: `/reset-password?token=${token}`,
      expires_at: issued.rows[0].expires_at,
      user: { id: user.id, full_name: user.full_name, email: user.email },
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

// The reset page checks the link before showing the form: POST /api/auth/password-reset/validate
async function inspect(req, res, next) {
  const parsed = tokenSchema.safeParse(req.body);
  if (!parsed.success) return res.status(410).json({ valid: false, message: EXPIRED_MESSAGE });

  try {
    const { rows } = await pool.query(
      `SELECT t.expires_at, u.email
         FROM password_reset_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > NOW() AND u.is_active = TRUE`,
      [hashToken(parsed.data.token)]
    );
    if (!rows.length) return res.status(410).json({ valid: false, message: EXPIRED_MESSAGE });
    res.json({ valid: true, account: maskEmail(rows[0].email), expires_at: rows[0].expires_at });
  } catch (error) {
    next(error);
  }
}

// POST /api/auth/password-reset/complete
async function complete(req, res, next) {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Choose a password of at least 8 characters.' });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Consume and apply in one statement: the UPDATE only matches an unused, unexpired link, so two
    // requests carrying the same link cannot both succeed.
    const { rows } = await client.query(
      `WITH consumed AS (
         UPDATE password_reset_tokens
            SET used_at = NOW()
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
          RETURNING user_id
       )
       UPDATE users u
          SET password_hash = $2
         FROM consumed c
        WHERE u.id = c.user_id AND u.is_active = TRUE
        RETURNING u.id, u.email, u.role`,
      [hashToken(parsed.data.token), passwordHash]
    );
    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(410).json({ message: EXPIRED_MESSAGE });
    }

    const user = rows[0];
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );
    await logAudit(user.id, 'USER_PASSWORD_RESET', 'users', user.id, { role: user.role }, client);
    await client.query('COMMIT');

    res.json({ message: 'Password updated. Sign in with the new password.' });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    next(error);
  } finally {
    client.release();
  }
}

module.exports = { issue, inspect, complete, RESET_TTL_MINUTES };
