const express = require('express');
const controller = require('../controllers/audit.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.get('/', authenticateToken, requireRole('admin'), controller.list);

module.exports = router;
