const express = require("express");
const controller = require("../controllers/reports.controller");
const authenticateToken = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");

const router = express.Router();

router.get(
  "/export",
  authenticateToken,
  requireRole("admin"),
  controller.exportReport
);

module.exports = router;
