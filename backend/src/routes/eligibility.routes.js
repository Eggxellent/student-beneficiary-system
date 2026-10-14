const express = require('express');
const controller = require('../controllers/eligibility.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.post('/', authenticateToken, requireRole('field_officer'), controller.calculate);

module.exports = router;
