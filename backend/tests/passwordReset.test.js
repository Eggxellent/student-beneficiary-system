const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('node:crypto');
const app = require('../src/index');
const pool = require('../src/config/db');

// The system has no outbound mail transport, so an administrator issues the one-time link and hands
// it over. These tests cover the whole chain the operator and the account holder go through: issue,
// validate, set a new password, and the two refusals that make the link safe to hand over (single use
// and short life).
describe('Password reset links', () => {
  const createdIds = [];
  const createdEmails = [];
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let adminToken;
  let adminAccount;

  async function createAccount(role, label) {
    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}@example.test`;
    createdEmails.push(email);
    const password_hash = await bcrypt.hash('OriginalPass123!', 4);
    const { rows } = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, role',
      [label, email, password_hash, role]
    );
    createdIds.push(rows[0].id);
    return {
      user: rows[0],
      email,
      token: jwt.sign({ id: rows[0].id, role }, process.env.JWT_SECRET, { expiresIn: '8h' }),
    };
  }

  // `account` is the object createAccount returns. Passing token = null exercises the
  // unauthenticated path, which must be refused before the target account is even looked up.
  function issue(account, token = adminToken) {
    const issued = request(app)
      .post(`/api/users/${account.user.id}/password-reset`)
      .send({});
    if (token) issued.set('Authorization', `Bearer ${token}`);
    return issued;
  }

  beforeAll(async () => {
    adminAccount = await createAccount('admin', 'Reset Admin');
    adminToken = adminAccount.token;
  });

  afterAll(async () => {
    const cleanupFailures = [];
    const attemptCleanup = async (label, operation) => {
      try {
        await operation();
      } catch {
        cleanupFailures.push(label);
      }
    };

    try {
      if (createdIds.length || createdEmails.length) {
        await attemptCleanup('audit-row cleanup', () => pool.query(
          `DELETE FROM audit_logs
            WHERE user_id = ANY($1::uuid[])
               OR record_id = ANY($1::uuid[])
               OR record_id IN (SELECT id FROM users WHERE email = ANY($2::text[]))`,
          [createdIds, createdEmails]
        ));
        await attemptCleanup('user cleanup', () => pool.query(
          'DELETE FROM users WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])',
          [createdIds, createdEmails]
        ));
      }
    } finally {
      await attemptCleanup('database pool shutdown', () => pool.end());
    }

    if (cleanupFailures.length) {
      throw new Error(`Test cleanup failed: ${cleanupFailures.join(', ')}`);
    }
  });

  test('only an administrator can issue a link, and the link is a fresh 64-character token', async () => {
    const officer = await createAccount('field_officer', 'Reset Issue Officer');

    expect((await issue(officer, null)).statusCode).toBe(401);
    expect((await issue(officer, officer.token)).statusCode).toBe(403);
    expect((await request(app)
      .post(`/api/users/${crypto.randomUUID()}/password-reset`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})).statusCode).toBe(404);

    const issued = await issue(officer);
    expect(issued.statusCode).toBe(201);
    expect(issued.body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(issued.body.reset_path).toBe(`/reset-password?token=${issued.body.token}`);
    expect(new Date(issued.body.expires_at).getTime()).toBeGreaterThan(Date.now());

    // The handed-over value is not what the database keeps: a copy of the table cannot reset an
    // account without the token itself.
    const stored = await pool.query(
      `SELECT token_hash, issued_by, created_at,
              EXTRACT(EPOCH FROM (expires_at - created_at)) / 60 AS ttl_minutes
         FROM password_reset_tokens WHERE user_id = $1`,
      [officer.user.id]
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].token_hash).toBe(crypto.createHash('sha256').update(issued.body.token).digest('hex'));
    expect(stored.rows[0].token_hash).not.toBe(issued.body.token);
    // Who issued the link is on the row itself, and the window is the 30 minutes the operator was
    // promised rather than whatever the client believes.
    expect(stored.rows[0].issued_by).toBe(adminAccount.user.id);
    expect(Number(stored.rows[0].ttl_minutes)).toBeCloseTo(30, 1);
    expect(new Date(stored.rows[0].created_at).getTime()).toBeLessThanOrEqual(Date.now());

    const audit = await pool.query(
      "SELECT user_id, details, created_at FROM audit_logs WHERE action = 'ADMIN_ISSUE_PASSWORD_RESET' AND record_id = $1",
      [officer.user.id]
    );
    expect(audit.rows).toHaveLength(1);
    // The audit row names the administrator who acted, not the account that was reset.
    expect(audit.rows[0].user_id).toBe(adminAccount.user.id);
    expect(audit.rows[0].details.email).toBe(officer.email);
    expect(new Date(audit.rows[0].created_at).getTime()).toBeLessThanOrEqual(Date.now());
    // The token itself never reaches the audit trail; only the link holder sees it.
    expect(JSON.stringify(audit.rows[0].details)).not.toContain(issued.body.token);
  });

  test('a validated link sets a new password once, and the new password is what signs in', async () => {
    const officer = await createAccount('field_officer', 'Reset Happy Officer');
    const issued = await issue(officer);
    const newPassword = 'Replacement456!';

    const checked = await request(app)
      .post('/api/auth/password-reset/validate')
      .send({ token: issued.body.token });
    expect(checked.statusCode).toBe(200);
    expect(checked.body.valid).toBe(true);
    // The page only needs to confirm which mailbox is being reset, so the address is masked.
    expect(checked.body.account).not.toBe(officer.email);
    expect(checked.body.account).toMatch(/^[a-z]\*+@example\.test$/);
    // The link is handed over once, at issue time; no read path echoes it back.
    expect(JSON.stringify(checked.body)).not.toContain(issued.body.token);

    const completed = await request(app)
      .post('/api/auth/password-reset/complete')
      .send({ token: issued.body.token, password: newPassword });
    expect(completed.statusCode).toBe(200);
    expect(completed.body.message).toMatch(/Password updated/);

    // The old password no longer works and the new one does, through the single sign-in form.
    expect((await request(app)
      .post('/api/auth/login')
      .send({ email: officer.email, password: 'OriginalPass123!' })).statusCode).toBe(401);
    const signedIn = await request(app)
      .post('/api/auth/login')
      .send({ email: officer.email, password: newPassword });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.body.user.role).toBe('field_officer');

    // The same link is dead on the second attempt.
    const replayed = await request(app)
      .post('/api/auth/password-reset/complete')
      .send({ token: issued.body.token, password: 'AnotherPass789!' });
    expect(replayed.statusCode).toBe(410);
    expect((await request(app)
      .post('/api/auth/password-reset/validate')
      .send({ token: issued.body.token })).statusCode).toBe(410);

    expect((await request(app)
      .post('/api/auth/password-reset/complete')
      .send({ token: issued.body.token, password: 'short' })).statusCode).toBe(400);
  });

  test('issuing a second link retires the first one', async () => {
    const officer = await createAccount('field_officer', 'Reset Supersede Officer');
    const first = await issue(officer);
    const second = await issue(officer);

    expect((await request(app)
      .post('/api/auth/password-reset/complete')
      .send({ token: first.body.token, password: 'Superseded123!' })).statusCode).toBe(410);
    expect((await request(app)
      .post('/api/auth/password-reset/complete')
      .send({ token: second.body.token, password: 'Superseded123!' })).statusCode).toBe(200);
  });

  test('an expired link is refused even though it was never used', async () => {
    const officer = await createAccount('field_officer', 'Reset Expired Officer');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, NOW() - INTERVAL '1 minute')`,
      [officer.user.id, crypto.createHash('sha256').update(token).digest('hex')]
    );

    expect((await request(app)
      .post('/api/auth/password-reset/validate')
      .send({ token })).statusCode).toBe(410);
    const completed = await request(app)
      .post('/api/auth/password-reset/complete')
      .send({ token, password: 'ExpiredLink123!' });
    expect(completed.statusCode).toBe(410);
    expect(completed.body.message).toMatch(/no longer valid/);

    // The account still signs in with its original password.
    expect((await request(app)
      .post('/api/auth/login')
      .send({ email: officer.email, password: 'OriginalPass123!' })).statusCode).toBe(200);
  });

  test('an unknown or malformed token is refused and no password changes', async () => {
    // The flows above already spend most of the shared ten-request budget for this client IP, so the
    // window is cleared here: these probes must reach the validator, not the limiter. The production
    // limits are untouched.
    require('../src/middleware/passwordResetRateLimit').reset();
    const officer = await createAccount('field_officer', 'Reset Invalid Token Officer');
    const unknown = crypto.randomBytes(32).toString('hex');

    // Well formed, never issued.
    const checked = await request(app)
      .post('/api/auth/password-reset/validate')
      .send({ token: unknown });
    expect(checked.statusCode).toBe(410);
    expect(checked.body.valid).toBe(false);
    expect(checked.body.account).toBeUndefined();

    const completed = await request(app)
      .post('/api/auth/password-reset/complete')
      .send({ token: unknown, password: 'ShouldNotApply123!' });
    expect(completed.statusCode).toBe(410);

    // Not even token shaped: the check fails before any lookup.
    expect((await request(app)
      .post('/api/auth/password-reset/validate')
      .send({ token: 'not-a-token' })).statusCode).toBe(410);
    expect((await request(app)
      .post('/api/auth/password-reset/validate')
      .send({})).statusCode).toBe(410);

    // The officer's account still opens with its original password and not with the attempted one.
    expect((await request(app)
      .post('/api/auth/login')
      .send({ email: officer.email, password: 'OriginalPass123!' })).statusCode).toBe(200);
    expect((await request(app)
      .post('/api/auth/login')
      .send({ email: officer.email, password: 'ShouldNotApply123!' })).statusCode).toBe(401);
  });

  test('the single sign-in form returns the stored role for either account type', async () => {
    const admin = await createAccount('admin', 'Reset Sign In Admin');
    const officer = await createAccount('field_officer', 'Reset Sign In Officer');

    const adminResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: admin.email, password: 'OriginalPass123!' });
    expect(adminResponse.statusCode).toBe(200);
    expect(adminResponse.body.user.role).toBe('admin');

    const officerResponse = await request(app)
      .post('/api/auth/login')
      .send({ email: officer.email, password: 'OriginalPass123!' });
    expect(officerResponse.statusCode).toBe(200);
    expect(officerResponse.body.user.role).toBe('field_officer');
  });
});
