/**
 * Guardian application -> student record linkage.
 *
 * A guardian application and the student it describes are one event: the student row is what the
 * Admin and Field Officer screens read, so an application without a student is invisible to every
 * staff workflow. This module is the single place that turns a stored application into a student,
 * runs duplicate screening, links the two rows and records the automatic assessment.
 *
 * The caller owns the transaction (and the guardian advisory lock), because screening locks the
 * students table while the model scores the pairs.
 */
const { screenAndCreateStudent } = require('./studentRegistration');
const { assessAutomatically } = require('./automaticAssessment');
const logAudit = require('./auditLog');
const { normalizeKenyanPhone } = require('./studentRecordFormat');
const { APPROVED_SCHOOLS } = require('../config/schools');
const { isValidGuardianNationalId } = require('./guardianNationalId');

// students.school_code only accepts the configured codes, while the guardian form takes a free-text
// school name. Only an exact (case-insensitive) match is used; anything else keeps the submitted
// name on students.school_name instead of guessing a code.
function resolveSchoolCode(schoolName) {
  const wanted = String(schoolName || '').trim().toLowerCase();
  return APPROVED_SCHOOLS.find((school) => school.toLowerCase() === wanted) || null;
}

function kenyanPhoneOrNull(value) {
  const normalized = normalizeKenyanPhone(value);
  return /^\+254[17]\d{8}$/.test(normalized || '') ? normalized : null;
}

// The application row stores every value the student record needs, so a backfill of an application
// submitted before this pipeline existed produces exactly the same student as a new submission.
function submittedStudentFor(application) {
  return {
    full_name: application.student_full_name,
    date_of_birth: application.student_date_of_birth || null,
    school_code: resolveSchoolCode(application.school_name),
    school_name: application.school_name,
    guardian_id: application.user_id,
    guardian_name: application.guardian_full_name || null,
    // The admission number is the identifier the guardian form collects, and the only one the
    // model can use as decisive evidence. `upi` stays null: the form never captures one.
    admission_number: application.admission_number || null,
    upi: null,
    birth_certificate_number: application.student_identifier || null,
    national_id_number: null,
    primary_phone: kenyanPhoneOrNull(application.guardian_phone),
  };
}

async function linkGuardianApplicationStudent({ client, application, actorId }) {
  // National ID is read from the authenticated account relationship, never from request fields
  // or a copied student column. Invalid historical values stay unavailable for comparison.
  const guardianProfile = await client.query(
    `SELECT national_id FROM users WHERE id = $1 AND role = 'guardian'`,
    [application.user_id],
  );
  const guardianNationalId = guardianProfile.rows[0]?.national_id;
  const registration = await screenAndCreateStudent({
    client,
    submitted: {
      ...submittedStudentFor(application),
      guardian_national_id: isValidGuardianNationalId(guardianNationalId) ? guardianNationalId : null,
    },
    actorId,
    schoolName: application.school_name,
    source: 'guardian_application',
    applicationId: application.id,
  });

  const linked = await client.query(
    `UPDATE guardian_applications
        SET student_id = $1,
            status = $2,
            decided_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
            decision_note = NULL,
            updated_at = NOW()
      WHERE id = $4 RETURNING *`,
    [registration.student.id, registration.flags.length ? 'under_review' : 'approved', registration.flags.length === 0, application.id],
  );
  const linkedApplication = linked.rows[0];

  // An unflagged application is approved by duplicate screening and proceeds to assessment. A
  // flagged application stays under review and is blocked until an administrator clears the case.
  const assessment = await assessAutomatically({
    client,
    studentId: registration.student.id,
    trigger: 'registration_screening',
    triggerReference: linkedApplication.id,
    application: linkedApplication,
    actorId,
  });

  await logAudit(
    actorId,
    'GUARDIAN_APPLICATION_LINKED_STUDENT',
    'guardian_applications',
    linkedApplication.id,
    {
      reference: linkedApplication.reference,
      student_id: registration.student.id,
      duplicate_flags_created: registration.flags.length,
      assessment_status: assessment.status,
    },
    client,
  );

  return {
    application: {
      ...linkedApplication,
      duplicate_screening_status: registration.flags.length ? 'under_review' : 'cleared',
    },
    student: registration.student,
    flags: registration.flags,
    screening: registration.screening,
    assessment,
  };
}

module.exports = { linkGuardianApplicationStudent, submittedStudentFor, resolveSchoolCode, kenyanPhoneOrNull };
