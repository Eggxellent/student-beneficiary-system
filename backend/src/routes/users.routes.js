const express = require('express');
const controller = require('../controllers/users.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();
router.use(authenticateToken, requireRole('admin'));
router.get('/', controller.list);
router.post('/', controller.create);
router.patch('/:id/role', controller.updateRole);
module.exports = router;
