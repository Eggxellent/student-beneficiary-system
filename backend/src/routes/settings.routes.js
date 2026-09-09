const express = require('express');
const controller = require('../controllers/settings.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.get('/threshold', authenticateToken, controller.getThreshold);
router.put('/threshold', authenticateToken, requireRole('admin'), controller.updateThreshold);

module.exports = router;
