const {
  calculateEligibility,
  CATEGORY_BANDS,
  CATEGORY_LABELS,
} = require('../services/eligibility');
const { getEligibilityAmountRanges } = require('../config/settings');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');
const { z } = require('zod');
const { ASSESSMENT_INPUTS, loadEligibilityWorkflow, awardReadinessError } = require('../services/eligibilityWorkflow');

const correctionSchema = z.object({
  reason: z.string().trim().min(5).max(2000),
  fee_balance: z.number().finite().min(0).max(1_000_000_000).optional(),
  household_income: z.number().finite().min(0).max(1_000_000_000).optional(),
  vulnerability_status: z.enum(['low', 'medium', 'high']).optional(),
  siblings_in_school: z.number().int().min(0).max(20).optional(),
  prior_bursary_history: z.enum(['none', 'low', 'high']).optional(),
}).strict().refine((data) => ASSESSMENT_INPUTS.some((key) => data[key] !== undefined), {
  message: 'Provide at least one corrected financial-need input.',
});

async function calculate(req, res, next) {
  // The former Field Officer form accepted replacement values and overwrote the current score.
  // Guardian submissions now drive scoring; only the audited Admin correction route may change it.
  return res.status(403).json({
    code: 'ELIGIBILITY_ASSESSMENT_READ_ONLY',
    message: 'Field Officers cannot replace eligibility inputs or recalculate assessments. Request an authorized Admin correction.',
  });
}

async function correctInputs(req, res, next) {
  const parsed = correctionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: 'Enter corrected values and a reason of at least 5 characters.', details: parsed.error.flatten() });
  }
  const actorId = req.user.id || req.user.sub;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('sbms.student.registration'))");
    await client.query('SELECT id FROM students WHERE id = $1 FOR UPDATE', [req.params.studentId]);
    const workflow = await loadEligibilityWorkflow(client, req.params.studentId);
    if (workflow.status === 'student_not_found') {
      await client.query('ROLLBACK');
      return res.status(404).json({ code: 'STUDENT_NOT_FOUND', message: 'Student not found.' });
    }
    const screeningError = awardReadinessError(workflow);
    if (screeningError && !['assessment_missing', 'assessment_incomplete'].includes(workflow.status)) {
      await client.query('ROLLBACK');
      return res.status(screeningError.status).json(screeningError);
    }

    const applicationResult = workflow.student.application_id
      ? await client.query('SELECT * FROM guardian_applications WHERE id = $1 FOR UPDATE', [workflow.student.application_id])
      : { rows: [] };
    const application = applicationResult.rows[0] || null;
    if (application?.status === 'rejected') {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'REJECTED_APPLICATION_READ_ONLY',
        message: 'Rejected applications are preserved and read-only. Submit a new application instead.',
      });
    }
    const previousAssessment = workflow.assessment || null;
    const before = {
      fee_balance: application?.fee_balance ?? previousAssessment?.fee_balance ?? null,
      household_income: application?.monthly_income ?? previousAssessment?.household_income ?? null,
      vulnerability_status: application?.vulnerability_status ?? previousAssessment?.vulnerability_status ?? null,
      siblings_in_school: application?.siblings_in_school ?? previousAssessment?.siblings_in_school ?? null,
      prior_bursary_history: application?.prior_bursary_history ?? previousAssessment?.prior_bursary_history ?? null,
    };
    const corrected = { ...before };
    for (const key of ASSESSMENT_INPUTS) {
      if (parsed.data[key] !== undefined) corrected[key] = parsed.data[key];
    }
    const missingInputs = ASSESSMENT_INPUTS.filter((key) => corrected[key] === null || corrected[key] === undefined);
    if (corrected.vulnerability_status !== null && !['low', 'medium', 'high'].includes(corrected.vulnerability_status)) missingInputs.push('vulnerability_status');
    if (corrected.prior_bursary_history !== null && !['none', 'low', 'high'].includes(corrected.prior_bursary_history)) missingInputs.push('prior_bursary_history');

    if (application) {
      const updatedApplication = await client.query(
        `UPDATE guardian_applications
            SET fee_balance = $1, monthly_income = $2, vulnerability_status = $3,
                siblings_in_school = $4, prior_bursary_history = $5, updated_at = NOW()
          WHERE id = $6 RETURNING id`,
        [corrected.fee_balance, corrected.household_income, corrected.vulnerability_status,
          corrected.siblings_in_school, corrected.prior_bursary_history, application.id],
      );
      if (!updatedApplication.rows.length) throw new Error('Guardian application disappeared during correction.');
    }

    const complete = missingInputs.length === 0;
    const assessment = complete ? calculateEligibility(corrected) : null;
    const category = assessment?.category || null;
    const inserted = await client.query(
      `INSERT INTO eligibility_assessments (
         student_id, score, category, fee_balance, household_income, vulnerability_status,
         siblings_in_school, prior_bursary_history, recommended_min, recommended_max,
         recommended_currency, recommendation_provisional, recommendation_source,
         recorded_via, assessed_by, assessed_at, status, missing_inputs, trigger, trigger_reference
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                 'admin_correction', $14, NOW(), $15, $16, 'admin_correction', $17)
       RETURNING id, status, score, category, missing_inputs, assessed_at`,
      [req.params.studentId, assessment?.score ?? null, category,
        corrected.fee_balance, corrected.household_income, corrected.vulnerability_status,
        corrected.siblings_in_school, corrected.prior_bursary_history,
        assessment?.recommended_range.min ?? null, assessment?.recommended_range.max ?? null,
        assessment?.recommended_range.currency ?? null, assessment?.recommended_range.provisional ?? true,
        assessment?.recommended_range.source ?? null, actorId, complete ? 'complete' : 'incomplete',
        [...new Set(missingInputs)], application?.id ?? null],
    );

    if (complete) {
      await client.query(
        `UPDATE students SET eligibility_score = $1, eligibility_category = $2, eligibility_assessed_at = NOW() WHERE id = $3`,
        [assessment.score, assessment.category, req.params.studentId],
      );
    } else {
      await client.query(
        `UPDATE students SET eligibility_score = NULL, eligibility_category = NULL, eligibility_assessed_at = NULL WHERE id = $1`,
        [req.params.studentId],
      );
    }
    await logAudit(actorId, 'ELIGIBILITY_INPUTS_CORRECTED', application ? 'guardian_applications' : 'students',
      application?.id || req.params.studentId, {
        student_id: req.params.studentId,
        application_id: application?.id || null,
        reason: parsed.data.reason,
        before,
        after: corrected,
        assessment_id: inserted.rows[0].id,
        assessment_status: complete ? 'complete' : 'incomplete',
        missing_inputs: [...new Set(missingInputs)],
        score: assessment?.score ?? null,
        category,
      }, client);
    await client.query('COMMIT');
    return res.json({
      assessment: { ...inserted.rows[0], inputs: corrected, ...(assessment || {}) },
      message: complete
        ? 'Financial-need inputs corrected and a new assessment recorded. Earlier submissions and assessments remain in the audit history.'
        : 'Correction saved. The assessment remains Incomplete; no score was produced.',
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return next(error);
  } finally {
    client.release();
  }
}
function describeFormula(req, res) {
  const amountRanges = getEligibilityAmountRanges();

  res.json({
    scale: 'Score out of 100 - five weighted factors',
    factors: [
      { key: 'fee_balance', label: 'Fee balance', max_points: 30, rules: ['>= 50,000: 30', '>= 30,000: 25', '>= 15,000: 15', '> 0: 5', '0: 0'] },
      { key: 'household_income', label: 'Household income', max_points: 25, rules: ['<= 20,000: 25', '<= 40,000: 20', '<= 60,000: 10', 'above 60,000: 0'] },
      { key: 'vulnerability_status', label: 'Vulnerability status', max_points: 25, rules: ['High: 25', 'Medium: 15', 'Low: 5'] },
      { key: 'siblings_in_school', label: 'Siblings in school', max_points: 10, rules: ['>= 4: 10', '2-3: 7', '1: 3', '0: 0'] },
      { key: 'prior_bursary_history', label: 'Prior bursary history', max_points: 10, rules: ['None: 10', 'Low: 7', 'High: 2'] },
    ],
    category_bands: CATEGORY_BANDS,
    category_labels: CATEGORY_LABELS,
    amount_ranges: amountRanges.ranges,
    amount_ranges_provisional: amountRanges.provisional,
    amount_ranges_source: amountRanges.source,
    guidance: 'The result is a recommendation for the authorised officer; it never approves a bursary.',
  });
}

module.exports = { calculate, correctInputs, describeFormula };
