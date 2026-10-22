const jwt = require('jsonwebtoken');
const pool = require('../config/db');

async function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      message: 'Authentication token required'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id || decoded.sub;
    if (!userId) return res.status(401).json({ message: 'Invalid authentication token' });
    // The signed role claim is retained for old-token compatibility, but the
    // current role always comes from the server-side user record.
    const { rows } = await pool.query('SELECT id, role FROM users WHERE id = $1', [userId]);
    if (!rows.length) return res.status(401).json({ message: 'User account no longer exists' });
    req.user = { ...decoded, id: rows[0].id, role: rows[0].role };
    next();
  } catch (error) {
    if (error.name !== 'JsonWebTokenError' && error.name !== 'TokenExpiredError') return next(error);
    return res.status(401).json({
      message: 'Invalid or expired token'
    });
  }
}

module.exports = authenticateToken;
