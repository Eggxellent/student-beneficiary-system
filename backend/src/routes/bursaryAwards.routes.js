const express = require('express');
const controller = require('../controllers/bursaryAwards.controller');
const certificateController = require('../controllers/certificates.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticateToken);
router.get('/', requireRole('admin', 'field_officer'), controller.list);
router.post('/', requireRole('field_officer'), controller.create);
router.patch('/:id/decision', requireRole('admin'), controller.decide);

// A certificate is generated automatically when an administrator approves the award. This route
// remains for awards approved before that rule, and for retrying a failed attempt; it never returns
// a second certificate for the same award.
router.post('/:id/certificate', requireRole('admin'), certificateController.issue);
router.get('/:id/certificate', requireRole('admin', 'field_officer'), certificateController.get);
router.get('/:id/certificate.pdf', requireRole('admin', 'field_officer'), certificateController.downloadPdf);
// There is no revoke route: revocation is outside the SBMS scope. A certificate is issued once and
// stops verifying only when the award it certifies is no longer approved at the same amount.

module.exports = router;

