require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const beneficiariesRouter = require('./routes/beneficiaries.routes');
const authRouter = require('./routes/auth.routes');
const auditRouter = require('./routes/audit.routes');
const studentsRouter = require('./routes/students.routes');
const duplicateFlagsRouter = require('./routes/duplicateFlags.routes');
const disbursementsRouter = require('./routes/disbursements.routes');
const settingsRouter = require('./routes/settings.routes');
const reportsRouter = require('./routes/reports.routes');
const eligibilityRouter = require('./routes/eligibility.routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

const configuredOrigins = (process.env.CORS_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = configuredOrigins.length
  ? configuredOrigins
  : ['http://localhost:5173', 'http://localhost:5174'];

// The production frontend and API share an origin, so CORS is unnecessary unless
// a separate frontend origin has explicitly been configured.
if (process.env.NODE_ENV !== 'production' || configuredOrigins.length > 0) {
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS'));
    },
  }));
}
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/beneficiaries', beneficiariesRouter);
app.use('/api/auth', authRouter);
app.use('/api/audit-logs', auditRouter);
app.use('/api/students', studentsRouter);
app.use('/api/duplicate-flags', duplicateFlagsRouter);
app.use('/api/disbursements', disbursementsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/eligibility', eligibilityRouter);

const frontendDist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
