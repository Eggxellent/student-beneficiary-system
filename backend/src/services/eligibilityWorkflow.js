const ASSESSMENT_INPUTS = Object.freeze([
  'fee_balance',
  'household_income',
  'vulnerability_status',
  'siblings_in_school',
  'prior_bursary_history',
]);

const CATEGORY_FOR_SCORE = (score) => (score >= 70 ? 'high' : score >= 40 ? 'moderate' : 'low');

async function loadEligibilityWorkflow(client, studentId) {
  const { rows } = await client.query(
    `SELECT s.id, s.duplicate_of_student_id,
            app.id AS application_id,
            EXISTS (
              SELECT 1 FROM audit_logs screened
               WHERE screened.table_name = 'guardian_applications'
                 AND screened.record_id = app.id
                 AND screened.action = 'GUARDIAN_APPLICATION_LINKED_STUDENT'
            ) AS guardian_application_screened,
            EXISTS (
              SELECT 1 FROM audit_logs screened
               WHERE screened.table_name = 'students'
                 AND screened.record_id = s.id
                 AND screened.action = 'CREATE'
                 AND screened.details ? 'duplicate_model_version'
            ) AS legacy_student_screened,
            EXISTS (
              SELECT 1 FROM duplicate_flags f
               WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
                 AND f.status IN ('pending', 'needs_verification')
            ) AS has_open_case,
            EXISTS (
              SELECT 1 FROM duplicate_flags f
               WHERE (f.student_id = s.id OR f.matched_student_id = s.id)
                 AND f.status = 'confirmed_duplicate'
                 AND NOT EXISTS (SELECT 1 FROM duplicate_resolutions r WHERE r.duplicate_flag_id = f.id)
            ) AS has_unresolved_confirmed_case
       FROM students s
       LEFT JOIN LATERAL (
         SELECT a.id FROM guardian_applications a
          WHERE a.student_id = s.id
          ORDER BY a.created_at DESC, a.id DESC LIMIT 1
       ) app ON TRUE
      WHERE s.id = $1`,
    [studentId],
  );
  const student = rows[0];
  if (!student) return { status: 'student_not_found' };

  const screened = student.application_id
    ? student.guardian_application_screened
    : student.legacy_student_screened;
  if (!screened) return { status: 'screening_required', student };
  if (student.duplicate_of_student_id || student.has_open_case || student.has_unresolved_confirmed_case) {
    return { status: 'duplicate_review', student };
  }

  const assessmentResult = await client.query(
    `SELECT ea.* FROM eligibility_assessments ea
      WHERE ea.student_id = $1
        AND (
          $2::uuid IS NULL
          OR (ea.trigger IN ('registration_screening', 'admin_correction') AND ea.trigger_reference = $2)
          OR (ea.trigger = 'duplicate_clearance' AND EXISTS (
            SELECT 1 FROM duplicate_flags f
            JOIN duplicate_review_events review
              ON review.duplicate_flag_id = f.id AND review.decision = 'not_duplicate'
            WHERE f.id = ea.trigger_reference
              AND (f.student_id = ea.student_id OR f.matched_student_id = ea.student_id)
          ))
        )
      ORDER BY ea.assessed_at DESC, ea.created_at DESC, ea.id DESC
      LIMIT 1`,
    [studentId, student.application_id],
  );
  const assessment = assessmentResult.rows[0] || null;
  if (!assessment) return { status: 'assessment_missing', student };

  const missingInputs = ASSESSMENT_INPUTS.filter((key) => {
    if (assessment[key] === null || assessment[key] === undefined) return true;
    if (key === 'vulnerability_status') return !['low', 'medium', 'high'].includes(assessment[key]);
    if (key === 'prior_bursary_history') return !['none', 'low', 'high'].includes(assessment[key]);
    return false;
  });
  const validScore = assessment.score !== null && assessment.score !== undefined
    && Number.isInteger(Number(assessment.score)) && Number(assessment.score) >= 0 && Number(assessment.score) <= 100;
  const validCategory = ['high', 'moderate', 'low'].includes(assessment.category)
    && Number(assessment.score) >= 0
    && CATEGORY_FOR_SCORE(Number(assessment.score)) === assessment.category;
  if (assessment.status !== 'complete' || missingInputs.length || !validScore || !validCategory) {
    return {
      status: 'assessment_incomplete',
      student,
      assessment,
      missingInputs: [...new Set([...(assessment.missing_inputs || []), ...missingInputs])],
    };
  }
  return { status: 'ready', student, assessment };
}

function awardReadinessError(state) {
  if (state.status === 'student_not_found') {
    return { status: 404, code: 'STUDENT_NOT_FOUND', message: 'Student not found.' };
  }
  if (state.status === 'screening_required') {
    return { status: 409, code: 'DUPLICATE_SCREENING_REQUIRED', message: 'Duplicate screening must be explicitly cleared before award consideration.' };
  }
  if (state.status === 'duplicate_review') {
    return { status: 409, code: 'ELIGIBILITY_BLOCKED_BY_DUPLICATE', message: 'This student has an unresolved duplicate case. Resolve it before award consideration.' };
  }
  if (state.status === 'assessment_missing') {
    return { status: 409, code: 'ELIGIBILITY_ASSESSMENT_REQUIRED', message: 'A completed financial-need assessment is required before an award can be proposed or approved.' };
  }
  if (state.status === 'assessment_incomplete') {
    return {
      status: 409,
      code: 'ELIGIBILITY_ASSESSMENT_INCOMPLETE',
      message: 'The financial-need assessment is incomplete or invalid. Correct the listed information before award consideration.',
      missing_inputs: state.missingInputs,
    };
  }
  return null;
}

module.exports = { ASSESSMENT_INPUTS, loadEligibilityWorkflow, awardReadinessError };
