const express = require('express');
const controller = require('../controllers/bursaryAwards.controller');
const certificateController = require('../controllers/certificates.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticateToken);
router.get('/', requireRole('admin', 'field_officer'), controller.list);
router.post('/', requireRole('field_officer'), controller.create);
router.post('/:id/verification', requireRole('field_officer'), controller.recordVerification);
router.patch('/:id/decision', requireRole('admin'), controller.decide);

// A certificate is issued only by an administrator, because only an administrator can approve the
// award it certifies. Reading and printing are shared with field officers, who hand the printed
// document to the student or school.
router.post('/:id/certificate', requireRole('admin'), certificateController.issue);
router.get('/:id/certificate', requireRole('admin', 'field_officer'), certificateController.get);
router.get('/:id/certificate.pdf', requireRole('admin', 'field_officer'), certificateController.downloadPdf);
router.post('/:id/certificate/revoke', requireRole('admin'), certificateController.revoke);

module.exports = router;

