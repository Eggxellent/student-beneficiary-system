require('dotenv').config();
const express = require('express');
const cors = require('cors');
const beneficiariesRouter = require('./routes/beneficiaries.routes');
const authRouter = require('./routes/auth.routes');
const auditRouter = require('./routes/audit.routes');
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
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
