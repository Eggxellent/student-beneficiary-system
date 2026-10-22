const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const app = require('../src/index');
const pool = require('../src/config/db');

describe('Admin and Field Officer authorization', () => {
  const createdIds = [];
  const emailSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let admin;
  let officer;
  let adminToken;
  let officerToken;

  async function createAccount(role, label) {
    const email = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${emailSuffix}@example.test`;
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
    if (createdIds.length) {
      await pool.query('DELETE FROM audit_logs WHERE user_id = ANY($1::uuid[])', [createdIds]);
      await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [createdIds]);
    }
    await pool.end();
  });

  test('unauthenticated callers receive 401; admin can list and create accounts', async () => {
    expect((await request(app).get('/api/users')).statusCode).toBe(401);
    const listing = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(listing.statusCode).toBe(200);
    expect(listing.body.every(({ password_hash }) => password_hash === undefined)).toBe(true);
    expect(listing.body.every(({ role }) => ['admin', 'field_officer'].includes(role))).toBe(true);

    const created = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
      full_name: 'Created by Administrator', email: `created-${emailSuffix}@example.test`, password: 'Temporary123!', role: 'admin',
    });
    expect(created.statusCode).toBe(201);
    createdIds.push(created.body.id);
    const audit = await pool.query("SELECT action, details FROM audit_logs WHERE record_id = $1", [created.body.id]);
    expect(audit.rows.some((row) => row.action === 'ADMIN_CREATE_USER' && row.details.role === 'admin')).toBe(true);

    const invalidRole = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
      full_name: 'Invalid Role Account', email: `invalid-${emailSuffix}@example.test`, password: 'Temporary123!', role: 'invalid',
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
    expect((await request(app).post('/api/users').set('Authorization', `Bearer ${officerToken}`).send({})).statusCode).toBe(403);
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
