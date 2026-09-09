const express = require('express');
const controller = require('../controllers/students.controller');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

router.use(authenticateToken);
router.get('/', controller.list);
router.get('/:id', controller.get);
router.post('/', controller.create);

module.exports = router;
