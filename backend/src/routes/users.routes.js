const express = require('express');
const controller = require('../controllers/users.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(authenticateToken, requireRole('admin'));
router.get('/', asyncHandler(controller.list));
router.post('/', asyncHandler(controller.create));
router.patch('/:id/role', asyncHandler(controller.updateRole));
module.exports = router;
