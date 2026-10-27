const express = require('express');
const controller = require('../controllers/auth.controller');
const authenticateToken = require('../middleware/auth');
const loginRateLimit = require('../middleware/loginRateLimit');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/register', (req, res) => {
  res.status(410).json({ message: 'Public registration is disabled.' });
});
router.post('/login/admin', loginRateLimit, asyncHandler(controller.loginAdmin));
router.post('/login/field-officer', loginRateLimit, asyncHandler(controller.loginFieldOfficer));
router.get('/me', authenticateToken, asyncHandler(controller.me));

module.exports = router;
