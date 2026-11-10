const {
  calculateEligibility,
  CATEGORY_BANDS,
  CATEGORY_LABELS,
} = require('../services/eligibility');
const { getEligibilityAmountRanges } = require('../config/settings');
const pool = require('../config/db');
const logAudit = require('../services/auditLog');

async function calculate(req, res, next) {
  const {
    fee_balance,
    household_income,
    vulnerability_status,
    siblings_in_school,
    prior_bursary_history,
    student_id,
  } = req.body;

  // A registered student must be selected: the assessment is stored against
  // that student's record, so there is nothing to calculate without one.
  if (typeof student_id !== 'string' || student_id.trim() === '') {
    return res.status(400).json({ message: 'Select a registered student before calculating eligibility' });
  }

  const numericValues = [fee_balance, household_income, siblings_in_school];
  if (numericValues.some((value) => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    return res.status(400).json({ message: 'Fee balance, household income, and siblings must be non-negative numbers' });
  }

  if (!['low', 'medium', 'high'].includes(vulnerability_status)) {
    return res.status(400).json({ message: 'Invalid vulnerability status' });
  }

  if (!['none', 'low', 'high'].includes(prior_bursary_history)) {
    return res.status(400).json({ message: 'Invalid prior bursary history' });
  }

  try {
    const assessment = calculateEligibility({
      fee_balance,
      household_income,
      vulnerability_status,
      siblings_in_school,
      prior_bursary_history,
    });

    const result = await pool.query(
      `UPDATE students
       SET eligibility_score = $1,
           eligibility_category = $2,
           eligibility_assessed_at = NOW()
       WHERE id = $3
       RETURNING id, full_name, upi, school_code`,
      [assessment.score, assessment.category, student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Student not found' });
    }

    const student = result.rows[0];

    try {
      await logAudit(req.user.id, 'ELIGIBILITY_CALCULATED', 'students', student.id, {
        score: assessment.score,
        category: assessment.category,
        recommended_range: assessment.recommended_range,
        inputs: {
          fee_balance,
          household_income,
          vulnerability_status,
          siblings_in_school,
          prior_bursary_history,
        },
      });
    } catch (auditError) {
      return next(auditError);
    }

    return res.json({
      ...assessment,
      student: {
        id: student.id,
        full_name: student.full_name,
        upi: student.upi,
        school_code: student.school_code,
      },
    });
  } catch (error) {
    return next(error);
  }
}

// Read-only configuration view so the officer UI can display the exact scoring
// formula and the amount ranges (approved or provisional) in force.
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

module.exports = { calculate, describeFormula };
