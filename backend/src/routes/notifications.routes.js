const express = require('express');
const controller = require('../controllers/notifications.controller');
const authenticateToken = require('../middleware/auth');

const router = express.Router();
router.use(authenticateToken);

// No role guard: the row's owner is the permission. What a user receives is decided when the
// notification is written (administrators for proposals, the proposing officer for decisions and
// certificates), so every authenticated user may read and clear their own list and nothing else.
router.get('/', controller.list);
// Reading is removal: the row is deleted once the recipient opens it, and `DELETE /` clears the
// whole list for that user only.
router.delete('/', controller.clearAll);
router.delete('/:id', controller.dismiss);

module.exports = router;
