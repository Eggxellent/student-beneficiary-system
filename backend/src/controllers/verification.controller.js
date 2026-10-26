const studentModel = require('../models/student.model');

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

async function verify(req, res) {
  const body = req.body;
  const hasExactShape = body
    && typeof body === 'object'
    && !Array.isArray(body)
    && Object.keys(body).length === 1
    && Object.hasOwn(body, 'token');

  if (!hasExactShape || typeof body.token !== 'string' || !TOKEN_PATTERN.test(body.token)) {
    return res.json({ found: false });
  }

  try {
    const found = await studentModel.hasQrToken(body.token);
    return res.json({ found });
  } catch {
    // Never log or return the submitted token or database error details.
    return res.status(503).json({ error: 'temporarily_unavailable' });
  }
}

module.exports = { verify };
