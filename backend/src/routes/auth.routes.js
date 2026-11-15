const express = require('express');
const controller = require('../controllers/auth.controller');
const passwordReset = require('../controllers/passwordReset.controller');
const authenticateToken = require('../middleware/auth');
const loginRateLimit = require('../middleware/loginRateLimit');
const passwordResetRateLimit = require('../middleware/passwordResetRateLimit');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.post('/register', (req, res) => {
  res.status(410).json({ message: 'Public registration is disabled.' });
});
// One sign-in for everyone: the account's stored role decides where the user lands. The role-specific
// routes below stay for API clients that still name the role.
router.post('/login', loginRateLimit, asyncHandler(controller.loginAny));
router.post('/login/admin', loginRateLimit, asyncHandler(controller.loginAdmin));
router.post('/login/field-officer', loginRateLimit, asyncHandler(controller.loginFieldOfficer));
// The holder of a reset link checks it, then spends it. Both are unauthenticated by design and both
// are rate limited, and neither reveals whether an email address has an account.
router.post('/password-reset/validate', passwordResetRateLimit, asyncHandler(passwordReset.inspect));
router.post('/password-reset/complete', passwordResetRateLimit, asyncHandler(passwordReset.complete));
router.get('/me', authenticateToken, asyncHandler(controller.me));

module.exports = router;

