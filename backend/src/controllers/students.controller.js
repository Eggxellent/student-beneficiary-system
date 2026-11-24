const studentModel = require('../models/student.model');
const { APPROVED_SCHOOLS } = require('../config/schools');

// Student records are a read-only Field Officer view. Guardians register students through the
// Guardian Portal, which creates the linked student record, runs duplicate screening and triggers
// the eligibility assessment. Every read below applies the same duplicate rule.

// The roster used by the assessment and award forms. Duplicate-pending and confirmed-duplicate
// students are excluded here, so they cannot be selected or enumerated through the API.

async function list(req, res, next) {
  try { res.json(await studentModel.getFieldOfficerRoster()); } catch (error) { next(error); }
}

// The "Registered students" view the field officer lands on. Only duplicate-cleared,
// eligibility-assessed guardian registrations are returned; the filter is in the query so a
// direct API call cannot obtain a wider list than the screen shows.
async function listRegistered(req, res, next) {
  try { res.json(await studentModel.getFieldOfficerRegisteredStudents()); } catch (error) { next(error); }
}

// Dashboard metrics, attention list and recent registrations, all built from the same filter.
async function overview(req, res, next) {
  try { res.json(await studentModel.getFieldOfficerOverview()); } catch (error) { next(error); }
}

// Read-only eligibility findings for the Field Officer screen: every duplicate-cleared guardian
// registration with the application it came from and the assessment the engine recorded.
async function listEligibilityFindings(req, res, next) {
  try { res.json(await studentModel.getFieldOfficerEligibilityFindings()); } catch (error) { next(error); }
}

async function listSchools(req, res, next) {
  try {
    res.json(APPROVED_SCHOOLS);
  } catch (error) { next(error); }
}

async function get(req, res, next) {
  try {
    const student = await studentModel.getFieldOfficerStudent(req.params.id);
    if (!student) return res.status(404).json({ message: 'Student not found' });
    res.json(student);
  } catch (error) { next(error); }
}

module.exports = { list, listRegistered, overview, listEligibilityFindings, listSchools, get };
