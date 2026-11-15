const express = require('express');
const controller = require('../controllers/users.controller');
const passwordReset = require('../controllers/passwordReset.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();
router.use(authenticateToken, requireRole('admin'));
router.get('/', asyncHandler(controller.list));
router.post('/', asyncHandler(controller.create));
// There is no outbound mail transport, so an administrator issues the one-time link and hands it
// over. The link itself is returned once, in this response, and only its hash is stored.
router.post('/:id/password-reset', asyncHandler(passwordReset.issue));
router.patch('/:id/role', asyncHandler(controller.updateRole));
router.delete('/:id', asyncHandler(controller.remove));
module.exports = router;
