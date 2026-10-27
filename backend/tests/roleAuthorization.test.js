const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../src/index');
const pool = require('../src/config/db');

describe('Admin and Field Officer authorization', () => {
  const createdIds = [];
  const createdEmails = [];
  const emailSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let admin;
  let officer;
  let adminToken;
  let officerToken;

  async function createAccount(role, label) {
    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${emailSuffix}@example.test`;
    createdEmails.push(email);
    const password_hash = await bcrypt.hash('TestPassword123!', 4);
    const { rows } = await pool.query(
      'INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, full_name, email, role',
      [label, email, password_hash, role]
    );
    createdIds.push(rows[0].id);
    const token = jwt.sign({ id: rows[0].id, role }, process.env.JWT_SECRET, { expiresIn: '8h' });
    return { user: rows[0], token };
  }

  beforeAll(async () => {
    admin = await createAccount('admin', 'Role Test Admin');
    officer = await createAccount('field_officer', 'Role Test Officer');
    adminToken = admin.token;
    officerToken = officer.token;
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

  test('unauthenticated callers receive 401; admin can list and create accounts', async () => {
    expect((await request(app).get('/api/users')).statusCode).toBe(401);
    const anonymousEmail = `anonymous-${emailSuffix}@example.test`;
    createdEmails.push(anonymousEmail);
    const anonymousCreate = await request(app).post('/api/users').send({
      full_name: 'Anonymous Admin', email: anonymousEmail, password: 'Temporary123!', role: 'admin',
    });
    expect(anonymousCreate.statusCode).toBe(401);
    expect((await request(app).patch(`/api/users/${officer.user.id}/role`).send({ role: 'admin' })).statusCode).toBe(401);

    const listing = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(listing.statusCode).toBe(200);
    expect(listing.body.every(({ password_hash }) => password_hash === undefined)).toBe(true);
    expect(listing.body.every(({ role }) => ['admin', 'field_officer'].includes(role))).toBe(true);

    const adminCreatedEmail = `created-${emailSuffix}@example.test`;
    createdEmails.push(adminCreatedEmail);
    const created = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
      full_name: 'Created by Administrator', email: adminCreatedEmail, password: 'Temporary123!', role: 'admin',
    });
    expect(created.statusCode).toBe(201);
    createdIds.push(created.body.id);
    const audit = await pool.query("SELECT action, details FROM audit_logs WHERE record_id = $1", [created.body.id]);
    expect(audit.rows.some((row) => row.action === 'ADMIN_CREATE_USER' && row.details.role === 'admin')).toBe(true);

    const createdOfficerEmail = `created-officer-${emailSuffix}@example.test`;
    createdEmails.push(createdOfficerEmail);
    const createdOfficer = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
      full_name: 'Created Field Officer', email: createdOfficerEmail, password: 'Temporary123!', role: 'field_officer',
    });
    if (createdOfficer.body?.id) createdIds.push(createdOfficer.body.id);
    expect(createdOfficer.statusCode).toBe(201);
    expect(createdOfficer.body.role).toBe('field_officer');
    expect(createdOfficer.body.password_hash).toBeUndefined();

    const invalidRoleEmail = `invalid-${emailSuffix}@example.test`;
    createdEmails.push(invalidRoleEmail);
    const invalidRole = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
      full_name: 'Invalid Role Account', email: invalidRoleEmail, password: 'Temporary123!', role: 'invalid',
    });
    expect(invalidRole.statusCode).toBe(400);
  });

  test('separate sign-in endpoints reject accounts from the other role', async () => {
    const adminOnOfficerPortal = await request(app).post('/api/auth/login/field-officer').send({ email: admin.user.email, password: 'TestPassword123!' });
    const officerOnAdminPortal = await request(app).post('/api/auth/login/admin').send({ email: officer.user.email, password: 'TestPassword123!' });
    const adminOnAdminPortal = await request(app).post('/api/auth/login/admin').send({ email: admin.user.email, password: 'TestPassword123!' });
    const officerOnOfficerPortal = await request(app).post('/api/auth/login/field-officer').send({ email: officer.user.email, password: 'TestPassword123!' });
    expect(adminOnOfficerPortal.statusCode).toBe(403);
    expect(officerOnAdminPortal.statusCode).toBe(403);
    expect(adminOnAdminPortal.statusCode).toBe(200);
    expect(officerOnOfficerPortal.statusCode).toBe(200);
  });

  test('admin dashboard reports synthetic records accurately and stays admin-only', async () => {
    const expected = await pool.query('SELECT COUNT(*)::int AS count FROM students WHERE is_synthetic = TRUE');
    const dashboard = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.body.syntheticStudents).toBe(expected.rows[0].count);
    expect((await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${officerToken}`)).statusCode).toBe(403);
  });

  test('Field Officers cannot manage users or read/change global thresholds', async () => {
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${officerToken}`)).statusCode).toBe(403);
    const officerCreatedEmail = `officer-create-${emailSuffix}@example.test`;
    createdEmails.push(officerCreatedEmail);
    expect((await request(app).post('/api/users').set('Authorization', `Bearer ${officerToken}`).send({
      full_name: 'Unauthorized Admin', email: officerCreatedEmail, password: 'Temporary123!', role: 'admin',
    })).statusCode).toBe(403);
    expect((await request(app).patch(`/api/users/${officer.user.id}/role`).set('Authorization', `Bearer ${officerToken}`).send({ role: 'admin' })).statusCode).toBe(403);
    expect((await request(app).get('/api/settings/threshold').set('Authorization', `Bearer ${officerToken}`)).statusCode).toBe(403);
    expect((await request(app).put('/api/settings/threshold').set('Authorization', `Bearer ${officerToken}`).send({ threshold: 0.9 })).statusCode).toBe(403);
    const currentThreshold = await request(app).get('/api/settings/threshold').set('Authorization', `Bearer ${adminToken}`);
    expect(currentThreshold.statusCode).toBe(200);
    const settingsUpdate = await request(app).put('/api/settings/threshold').set('Authorization', `Bearer ${adminToken}`).send({ threshold: currentThreshold.body.threshold, reviewThreshold: currentThreshold.body.reviewThreshold });
    expect(settingsUpdate.statusCode).toBe(200);
    const settingsAudit = await pool.query("SELECT action FROM audit_logs WHERE user_id = $1 AND action = 'ADMIN_UPDATE_DUPLICATE_THRESHOLDS'", [admin.user.id]);
    expect(settingsAudit.rows).toHaveLength(1);
  });

  test('signed client role claims cannot grant admin access and role changes apply to existing tokens', async () => {
    const forgedRole = jwt.sign({ id: officer.user.id, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '8h' });
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${forgedRole}`)).statusCode).toBe(403);
    const changed = await request(app).patch(`/api/users/${officer.user.id}/role`).set('Authorization', `Bearer ${adminToken}`).send({ role: 'admin' });
    expect(changed.statusCode).toBe(200);
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${officerToken}`)).statusCode).toBe(200);
    const demoted = await request(app).patch(`/api/users/${officer.user.id}/role`).set('Authorization', `Bearer ${adminToken}`).send({ role: 'field_officer' });
    expect(demoted.statusCode).toBe(200);
    expect((await request(app).get('/api/users').set('Authorization', `Bearer ${officerToken}`)).statusCode).toBe(403);
    const audit = await pool.query("SELECT details FROM audit_logs WHERE action = 'ADMIN_CHANGE_USER_ROLE' AND record_id = $1 ORDER BY created_at DESC", [officer.user.id]);
    expect(audit.rows[0].details).toEqual({ from: 'admin', to: 'field_officer' });
  });
});
