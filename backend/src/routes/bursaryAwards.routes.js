const express = require('express');
const controller = require('../controllers/bursaryAwards.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticateToken);
router.get('/', requireRole('admin', 'field_officer'), controller.list);
router.post('/', requireRole('field_officer'), controller.create);
router.post('/:id/verification', requireRole('field_officer'), controller.recordVerification);
router.patch('/:id/decision', requireRole('admin'), controller.decide);

module.exports = router;
