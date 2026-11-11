const express = require('express');
const controller = require('../controllers/eligibility.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

// The scoring formula is internal: only an administrator may read the weights.
router.get('/', authenticateToken, requireRole('admin'), controller.describeFormula);
router.post('/', authenticateToken, requireRole('field_officer'), controller.calculate);

module.exports = router;
