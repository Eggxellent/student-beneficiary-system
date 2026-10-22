const express = require('express');
const controller = require('../controllers/auth.controller');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

router.post('/register', controller.register);
router.post('/login/admin', controller.loginAdmin);
router.post('/login/field-officer', controller.loginFieldOfficer);
router.get('/me', authenticateToken, controller.me);

module.exports = router;
