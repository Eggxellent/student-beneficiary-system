require('dotenv').config();
const { configureJwtSecret } = require('./config/jwtSecret');
const express = require('express');
const cors = require('cors');
const pool = require('./config/db');
const { getPublicAppOrigin } = require('./config/publicAppUrl');
const { checkDatabaseReadiness } = require('./services/databaseReadiness');
const { assertAuthenticationSchemaReady } = require('./services/databaseStartup');
const beneficiariesRouter = require('./routes/beneficiaries.routes');
const authRouter = require('./routes/auth.routes');
const auditRouter = require('./routes/audit.routes');
const studentsRouter = require('./routes/students.routes');
const verificationController = require('./controllers/verification.controller');
const verificationRateLimit = require('./middleware/verificationRateLimit');
const duplicateFlagsRouter = require('./routes/duplicateFlags.routes');
const disbursementsRouter = require('./routes/disbursements.routes');
const bursaryAwardsRouter = require('./routes/bursaryAwards.routes');
const settingsRouter = require('./routes/settings.routes');
const reportsRouter = require('./routes/reports.routes');
const eligibilityRouter = require('./routes/eligibility.routes');
const adminDashboardRouter = require('./routes/adminDashboard.routes');
const usersRouter = require('./routes/users.routes');
const errorHandler = require('./middleware/errorHandler');
const { getAllowedOrigins } = require('./config/cors');

const app = express();
const PORT = process.env.PORT || 5000;

const allowedOrigins = getAllowedOrigins();

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'microphone=(), geolocation=()');
  next();
});
app.use((req, res, next) => {
  const origin = req.get('Origin');
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ message: 'Origin is not allowed' });
  }
  next();
});
app.use(cors({ origin: (origin, callback) => callback(null, allowedOrigins.has(origin)) }));
app.post('/api/verify', verificationRateLimit);
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/ready', async (req, res) => {
  try {
    const expectedDatabaseName = process.env.SBMS_EXPECTED_DATABASE_NAME
      ?? (process.env.NODE_ENV === 'production' ? '' : undefined);
    const { ready } = await checkDatabaseReadiness(
      (query, values) => pool.query(query, values),
      { expectedDatabaseName },
    );
    return res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
  } catch {
    console.error('Database readiness check failed');
    return res.status(503).json({ status: 'not_ready' });
  }
});

app.use('/api/beneficiaries', beneficiariesRouter);
app.use('/api/auth', authRouter);
app.use('/api/audit-logs', auditRouter);
app.post('/api/verify', verificationController.verify);
app.use('/api/students', studentsRouter);
app.use('/api/duplicate-flags', duplicateFlagsRouter);
app.use('/api/disbursements', disbursementsRouter);
app.use('/api/awards', bursaryAwardsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/eligibility', eligibilityRouter);
app.use('/api/admin/dashboard', adminDashboardRouter);
app.use('/api/users', usersRouter);
app.use(errorHandler);

if (require.main === module) {
  (async () => {
    configureJwtSecret(process.env.JWT_SECRET);
    // Student registration cannot complete without a QR code, and the QR code embeds
    // this origin. Resolving it here turns a missing or unsafe PUBLIC_APP_URL into a
    // startup failure instead of a 500 on every registration request.
    getPublicAppOrigin();
    await assertAuthenticationSchemaReady(
      (query, values) => pool.query(query, values),
      { expectedDatabaseName: process.env.SBMS_EXPECTED_DATABASE_NAME },
    );
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })().catch(() => {
    console.error('Startup blocked: required SBMS configuration or authentication database is unavailable or incompatible.');
    process.exit(1);
  });
}

module.exports = app;
