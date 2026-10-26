const express = require('express');
const controller = require('../controllers/disbursements.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(authenticateToken);
router.get('/', controller.list);
router.get('/exceptions', requireRole('admin', 'field_officer'), controller.listExceptions);
router.post('/', requireRole('admin', 'field_officer'), controller.create);
router.patch('/:id/award', requireRole('admin'), controller.linkLegacyPayment);
router.patch('/:id/payment-status', requireRole('admin', 'field_officer'), controller.updatePaymentStatus);
router.patch('/:id/acknowledgement', requireRole('admin', 'field_officer'), controller.acknowledgeReceipt);

module.exports = router;
