const express = require('express');
const controller = require('../controllers/applications.controller');
const applicationSubmissionRateLimit = require('../middleware/applicationRateLimit');

const router = express.Router();

// Public: no token, no session. The limiter runs before the handler on both endpoints.
router.post('/', applicationSubmissionRateLimit, controller.submit);
router.post('/track', applicationSubmissionRateLimit.tracking, controller.track);

module.exports = router;
