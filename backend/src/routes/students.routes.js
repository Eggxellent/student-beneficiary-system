const express = require('express');
const controller = require('../controllers/students.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(authenticateToken, requireRole('field_officer'));
router.get('/schools', controller.listSchools);
router.get('/registered', controller.listRegistered);
router.get('/registered/overview', controller.overview);
router.get('/eligibility-findings', controller.listEligibilityFindings);
router.get('/', controller.list);
router.get('/:id', controller.get);

module.exports = router;
