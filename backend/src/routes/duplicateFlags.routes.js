const express = require('express');
const controller = require('../controllers/duplicateFlags.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.use(authenticateToken);
router.get('/', requireRole('admin'), controller.list);
router.post('/evaluate', requireRole('admin'), controller.evaluate);
router.patch('/:id', requireRole('admin'), controller.update);

module.exports = router;
