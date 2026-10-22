const express = require('express');
const controller = require('../controllers/disbursements.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(authenticateToken);
router.get('/', controller.list);
router.post('/', requireRole('field_officer'), controller.create);

module.exports = router;
