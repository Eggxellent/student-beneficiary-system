/**
 * Automatic eligibility assessment.
 *
 * Two events trigger it: a guardian registration that duplicate screening did not flag
 * (`registration_screening`), and an administrator clearing a false-positive duplicate
 * (`duplicate_clearance`). It reuses services/eligibility.js unchanged - no new scoring rules.
 *
 * The guardian application stores all five scoring inputs in its own columns, so a guardian
 * submission now produces a complete assessment. The resolver below still reads an input from the
 * details JSON when the column is empty, which covers applications submitted before the inputs were
 * collected. A missing input is never replaced with 0, because 0 is itself a scored value. When an
 * input is missing the assessment is recorded as `incomplete`: the available values are stored, the
 * missing keys are named, and no score or category is written. That state is deliberately different
 * from a pending duplicate review, which has no assessment row at all.
 *
 * The caller owns the transaction, so a failure rolls the whole event back rather than leaving a
 * half-recorded assessment.
 */
const logAudit = require('./auditLog');
const { calculateEligibility } = require('./eligibility');

const SCORING_INPUTS = Object.freeze([
  'fee_balance',
  'household_income',
  'vulnerability_status',
  'siblings_in_school',
  'prior_bursary_history',
]);

const VULNERABILITY_VALUES = Object.freeze(['low', 'medium', 'high']);
const PRIOR_BURSARY_VALUES = Object.freeze(['none', 'low', 'high']);

function nonNegativeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function nonNegativeInteger(value) {
  const parsed = nonNegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

// A guardian answer can live in its own application column or, when the form stores it as an extra
// answer, in the application's details JSON. The column is read first, then the JSON, so a value the
// guardian actually supplied is used and a value that was never supplied stays null. Nothing is
// derived from another field and no default replaces it: 0 is a scored value of its own.
function applicationValue(application, key) {
  if (!application) return null;
  const columnValue = application[key];
  if (columnValue !== null && columnValue !== undefined && columnValue !== '') return columnValue;
  const details = application.details;
  if (details && typeof details === 'object' && key in details) return details[key];
  return null;
}

function eligibilityInputsFromApplication(application) {
  const vulnerability = applicationValue(application, 'vulnerability_status');
  const priorBursary = applicationValue(application, 'prior_bursary_history');
  const householdIncome = applicationValue(application, 'monthly_income')
    ?? applicationValue(application, 'household_income');
  return {
    fee_balance: nonNegativeNumber(applicationValue(application, 'fee_balance')),
    household_income: nonNegativeNumber(householdIncome),
    vulnerability_status: VULNERABILITY_VALUES.includes(vulnerability) ? vulnerability : null,
    siblings_in_school: nonNegativeInteger(applicationValue(application, 'siblings_in_school')),
    prior_bursary_history: PRIOR_BURSARY_VALUES.includes(priorBursary) ? priorBursary : null,
  };
}

async function duplicateBlockReason(client, studentId) {
  const { rows } = await client.query(
    `SELECT s.duplicate_of_student_id,
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
            ) AS has_confirmed_case
       FROM students s WHERE s.id = $1`,
    [studentId],
  );
  const row = rows[0];
  if (!row) return 'student_not_found';
  if (row.duplicate_of_student_id) return 'marked_duplicate';
  if (row.has_open_case) return 'pending_duplicate_review';
  if (row.has_confirmed_case) return 'confirmed_duplicate';
  return null;
}

async function assessAutomatically({ client, studentId, trigger, triggerReference, application = null, actorId = null }) {
  const blockedBy = await duplicateBlockReason(client, studentId);
  // Eligibility must never run for an unresolved or confirmed duplicate.
  if (blockedBy) return { status: 'blocked', reason: blockedBy };
  // An automatic assessment is recorded by the system. Only a clearance decision taken by an
  // administrator names a human assessor, so a guardian is never written as the assessor.
  const assessedBy = trigger === 'duplicate_clearance' ? actorId : null;

  const existing = await client.query(
    'SELECT id, status FROM eligibility_assessments WHERE student_id = $1 AND trigger = $2 AND trigger_reference IS NOT DISTINCT FROM $3',
    [studentId, trigger, triggerReference || null],
  );
  if (existing.rows.length) {
    // A retried request is a no-op, not a second assessment.
    return { status: existing.rows[0].status, assessment_id: existing.rows[0].id, reason: 'already_recorded' };
  }

  const inputs = eligibilityInputsFromApplication(application);
  const missingInputs = SCORING_INPUTS.filter((key) => inputs[key] === null || inputs[key] === undefined);

  if (missingInputs.length) {
    const inserted = await client.query(
      `INSERT INTO eligibility_assessments (
         student_id, score, category, fee_balance, household_income, vulnerability_status,
         siblings_in_school, prior_bursary_history, recommended_min, recommended_max,
         recommended_currency, recommendation_provisional, recommendation_source,
         recorded_via, assessed_by, assessed_at, status, missing_inputs, trigger, trigger_reference
       ) VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, NULL, NULL, NULL, TRUE, NULL,
                 'automatic_assessment', $7, NOW(), 'incomplete', $8, $9, $10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        studentId,
        inputs.fee_balance,
        inputs.household_income,
        inputs.vulnerability_status,
        inputs.siblings_in_school,
        inputs.prior_bursary_history,
        assessedBy,
        missingInputs,
        trigger,
        triggerReference || null,
      ],
    );
    if (!inserted.rows.length) return { status: 'incomplete', reason: 'already_recorded', missing_inputs: missingInputs };

    await logAudit(actorId, 'ELIGIBILITY_ASSESSMENT_INCOMPLETE', 'students', studentId, {
      automatic: true,
      trigger,
      trigger_reference: triggerReference || null,
      missing_inputs: missingInputs,
      available_inputs: inputs,
    }, client);

    return { status: 'incomplete', assessment_id: inserted.rows[0].id, missing_inputs: missingInputs };
  }

  const assessment = calculateEligibility(inputs);
  const inserted = await client.query(
    `INSERT INTO eligibility_assessments (
       student_id, score, category, fee_balance, household_income, vulnerability_status,
       siblings_in_school, prior_bursary_history, recommended_min, recommended_max,
       recommended_currency, recommendation_provisional, recommendation_source,
       recorded_via, assessed_by, assessed_at, status, missing_inputs, trigger, trigger_reference
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
               'automatic_assessment', $14, NOW(), 'complete', '{}', $15, $16)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [
      studentId,
      assessment.score,
      assessment.category,
      inputs.fee_balance,
      inputs.household_income,
      inputs.vulnerability_status,
      inputs.siblings_in_school,
      inputs.prior_bursary_history,
      assessment.recommended_range.min,
      assessment.recommended_range.max,
      assessment.recommended_range.currency,
      assessment.recommended_range.provisional,
      assessment.recommended_range.source,
      assessedBy,
      trigger,
      triggerReference || null,
    ],
  );
  if (!inserted.rows.length) return { status: 'complete', reason: 'already_recorded' };

  await client.query(
    `UPDATE students
        SET eligibility_score = $1, eligibility_category = $2, eligibility_assessed_at = NOW()
      WHERE id = $3`,
    [assessment.score, assessment.category, studentId],
  );

  await logAudit(actorId, 'ELIGIBILITY_CALCULATED', 'students', studentId, {
    automatic: true,
    trigger,
    trigger_reference: triggerReference || null,
    score: assessment.score,
    category: assessment.category,
    recommended_range: assessment.recommended_range,
    inputs,
  }, client);

  return {
    status: 'complete',
    assessment_id: inserted.rows[0].id,
    score: assessment.score,
    category: assessment.category,
    missing_inputs: [],
  };
}

// Picks the record in a duplicate case that belongs to a guardian. The newly flagged side is
// preferred: at registration that is the record the guardian just submitted, and at resubmission
// it is the record whose application supplies the assessment inputs. Only when the flagged side
// has no guardian is the matched (canonical) side used, for example when an administrator clears a
// case found by a re-scan of an older record.
async function guardianStudentInCase(client, flag) {
  const { rows } = await client.query(
    'SELECT id, guardian_id FROM students WHERE id = ANY($1::uuid[])',
    [[flag.student_id, flag.matched_student_id]],
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const flagged = byId.get(flag.student_id);
  if (flagged?.guardian_id) return flagged;
  const matched = byId.get(flag.matched_student_id);
  return matched?.guardian_id ? matched : null;
}

async function latestApplicationForStudent(client, studentId) {
  const { rows } = await client.query(
    `SELECT * FROM guardian_applications WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [studentId],
  );
  return rows[0] || null;
}

module.exports = {
  SCORING_INPUTS,
  eligibilityInputsFromApplication,
  duplicateBlockReason,
  assessAutomatically,
  guardianStudentInCase,
  latestApplicationForStudent,
};
