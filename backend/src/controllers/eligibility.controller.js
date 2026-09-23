const { calculateEligibility } = require('../services/eligibility');
const pool = require('../config/db');

async function calculate(req, res, next) {
  const {
    fee_balance,
    household_income,
    vulnerability_status,
    siblings_in_school,
    prior_bursary_history,
    student_id,
  } = req.body;

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

    if (student_id) {
      const result = await pool.query(
        `UPDATE students
         SET eligibility_score = $1,
             eligibility_category = $2,
             eligibility_assessed_at = NOW()
         WHERE id = $3
         RETURNING id`,
        [assessment.score, assessment.category, student_id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'Student not found' });
      }
    }

    return res.json(assessment);
  } catch (error) {
    return next(error);
  }
}

module.exports = { calculate };
