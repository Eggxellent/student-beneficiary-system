const express = require('express');
const controller = require('../controllers/beneficiaries.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(authenticateToken);

router.get('/', controller.list);
router.get('/:id', controller.get);
router.post('/', requireRole('field_officer'), controller.create);
router.put('/:id', requireRole('field_officer'), controller.update);
router.delete('/:id', requireRole('field_officer'), controller.remove);

module.exports = router;
