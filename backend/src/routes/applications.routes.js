const express = require('express');
const controller = require('../controllers/applications.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const applicationSubmissionRateLimit = require('../middleware/applicationRateLimit');

const router = express.Router();

// Public: no token, no session. The limiter runs before the handler on both endpoints. The school
// list is public because the guardian form cannot ask a parent to sign in to see it.
router.get('/schools', controller.schools);
router.post('/', applicationSubmissionRateLimit, controller.submit);
router.post('/track', applicationSubmissionRateLimit.tracking, controller.track);

// Everything below is staff-only. Triage, resolution and rejection are administrator actions;
// investigation, verification and recording a withdrawal are field-officer actions, so no single
// role can take an application end to end. Identifier reveal is open to both staff roles because the
// reveal is audited: masking one role's reads while the other reads unmasked would be worse.
router.use(authenticateToken);
router.get('/', requireRole('field_officer', 'admin'), controller.list);
router.get('/:id', requireRole('field_officer', 'admin'), controller.detail);
router.get('/:id/identifiers', requireRole('field_officer', 'admin'), controller.revealIdentifiers);
router.post('/:id/triage', requireRole('admin'), controller.triage);
router.post('/:id/investigation', requireRole('field_officer'), controller.investigate);
router.post('/:id/resolve', requireRole('admin'), controller.resolveCase);
router.post('/:id/verify', requireRole('field_officer', 'admin'), controller.verify);
router.post('/:id/reject', requireRole('admin'), controller.reject);
router.post('/:id/withdraw', requireRole('field_officer', 'admin'), controller.withdraw);

module.exports = router;
