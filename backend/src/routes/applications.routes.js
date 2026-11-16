const express = require('express');
const controller = require('../controllers/applications.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const applicationSubmissionRateLimit = require('../middleware/applicationRateLimit');

const router = express.Router();

// Public: no token, no session. The limiter runs before the handler on both endpoints.
router.post('/', applicationSubmissionRateLimit, controller.submit);
router.post('/track', applicationSubmissionRateLimit.tracking, controller.track);

// Everything below is staff-only. Triage and resolution are administrator actions; investigation and
// verification are field-officer actions, so no single role can take an application end to end.
router.use(authenticateToken);
router.get('/', requireRole('field_officer', 'admin'), controller.list);
router.get('/:id', requireRole('field_officer', 'admin'), controller.detail);
router.post('/:id/triage', requireRole('admin'), controller.triage);
router.post('/:id/investigation', requireRole('field_officer'), controller.investigate);
router.post('/:id/resolve', requireRole('admin'), controller.resolveCase);
router.post('/:id/verify', requireRole('field_officer', 'admin'), controller.verify);

module.exports = router;
