const express = require('express');
const controller = require('../controllers/adminDashboard.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.get('/', authenticateToken, requireRole('admin'), controller.getSummary);

module.exports = router;
