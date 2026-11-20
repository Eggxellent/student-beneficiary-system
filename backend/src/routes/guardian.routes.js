const express = require('express');
const controller = require('../controllers/guardian.controller');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/requireRole');
const guardianRegistrationRateLimit = require('../middleware/guardianRegistrationRateLimit');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Public: guardian self-registration. Sign-in stays on the shared /api/auth/login endpoint.
router.post('/register', guardianRegistrationRateLimit, asyncHandler(controller.register));

router.use(authenticateToken);

// Guardian-only: every query is scoped to req.user.id, so one guardian can never read or write
// another guardian's applications.
router.get('/me', requireRole('guardian'), asyncHandler(controller.me));
router.patch('/me', requireRole('guardian'), asyncHandler(controller.updateProfile));
router.get('/dashboard', requireRole('guardian'), asyncHandler(controller.dashboard));
router.get('/applications', requireRole('guardian'), asyncHandler(controller.listApplications));
router.post('/applications', requireRole('guardian'), asyncHandler(controller.createApplication));
router.get('/applications/:reference', requireRole('guardian'), asyncHandler(controller.getApplication));

// Staff review of guardian applications. Field officers can see the queue; only an administrator
// records the decision. Existing admin and field-officer workflows are untouched.
router.get(
  '/staff/applications',
  requireRole('admin', 'field_officer'),
  asyncHandler(controller.staffQueue),
);
router.patch(
  '/staff/applications/:id/status',
  requireRole('admin'),
  asyncHandler(controller.staffDecision),
);

module.exports = router;
