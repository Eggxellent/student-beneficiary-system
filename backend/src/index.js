require('dotenv').config();
const express = require('express');
const cors = require('cors');
const beneficiariesRouter = require('./routes/beneficiaries.routes');
const authRouter = require('./routes/auth.routes');
const auditRouter = require('./routes/audit.routes');
const studentsRouter = require('./routes/students.routes');
const duplicateFlagsRouter = require('./routes/duplicateFlags.routes');
const disbursementsRouter = require('./routes/disbursements.routes');
const settingsRouter = require('./routes/settings.routes');
const reportsRouter = require('./routes/reports.routes');
const eligibilityRouter = require('./routes/eligibility.routes');
const adminDashboardRouter = require('./routes/adminDashboard.routes');
const usersRouter = require('./routes/users.routes');
const errorHandler = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
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
app.use('/api/admin/dashboard', adminDashboardRouter);
app.use('/api/users', usersRouter);
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
