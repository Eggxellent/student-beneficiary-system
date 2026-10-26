const express = require('express');
const controller = require('../controllers/verification.controller');
const verificationRateLimit = require('../middleware/verificationRateLimit');

const router = express.Router();

router.post('/', verificationRateLimit, controller.verify);

module.exports = router;
