const express = require('express');
const controller = require('../controllers/notifications.controller');
const authenticateToken = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// No role guard: the row's owner is the permission. What a user receives is decided when the
// notification is written (administrators for proposals, the proposing officer for decisions and
// certificates), so every authenticated user may read their own list and nothing else.
router.get('/', controller.list);
router.post('/read-all', controller.markAllRead);
router.patch('/:id/read', controller.markRead);

module.exports = router;
