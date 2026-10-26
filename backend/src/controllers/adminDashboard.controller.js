const pool = require('../config/db');
const { acknowledgementOverdueDays } = require('../config/reconciliation');

const monthlyTrendQuery = (table, dateColumn) => `
  WITH months AS (
    SELECT date_trunc('month', CURRENT_DATE) - (interval '1 month' * month_offset) AS month
    FROM generate_series(5, 0, -1) AS offsets(month_offset)
  ), monthly_counts AS (
    SELECT date_trunc('month', ${dateColumn}) AS month, COUNT(*)::int AS count
    FROM ${table}
    WHERE ${dateColumn} >= (SELECT MIN(month) FROM months)
    GROUP BY 1
  )
  SELECT
    to_char(months.month, 'YYYY-MM') AS key,
    to_char(months.month, 'Mon') AS label,
    SUM(COALESCE(monthly_counts.count, 0)) OVER (ORDER BY months.month)::int AS total
  FROM months
  LEFT JOIN monthly_counts USING (month)
  ORDER BY months.month
`;

async function getSummary(req, res, next) {
  try {
    const [studentCounts, duplicateCounts, studentTrend, disbursementTrend, activities, accountability] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_students,
          COUNT(*) FILTER (WHERE eligibility_category IN ('eligible', 'highly_eligible'))::int AS eligible_students,
          COUNT(*) FILTER (WHERE is_synthetic)::int AS synthetic_students
        FROM students
      `),
      pool.query("SELECT COUNT(*)::int AS duplicate_count FROM duplicate_flags WHERE status IN ('pending', 'needs_verification')"),
      pool.query(monthlyTrendQuery('students', 'created_at')),
      pool.query(monthlyTrendQuery('disbursements', 'disbursement_date::timestamp')),
      pool.query('SELECT id, action, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 4'),
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM bursary_awards WHERE status = 'approved') AS approved_awards,
           (SELECT COUNT(DISTINCT award_id)::int FROM disbursements WHERE payment_status IN ('issued', 'cleared')) AS disbursed_awards,
           (SELECT COUNT(*)::int FROM bursary_awards a WHERE a.status = 'approved'
             AND NOT EXISTS (SELECT 1 FROM disbursements d WHERE d.award_id = a.id
               AND (d.payment_status IS NULL OR d.payment_status NOT IN ('failed', 'cancelled')))) AS no_payment_awards,
           (SELECT COALESCE(SUM(amount), 0)::numeric FROM disbursements WHERE payment_status IN ('issued', 'cleared')) AS disbursed_amount,
           (SELECT COUNT(*)::int FROM disbursements WHERE payment_status = 'issued') AS awaiting_clearance,
           (SELECT COUNT(*)::int FROM disbursements WHERE receipt_status = 'awaiting_acknowledgement') AS awaiting_receipt,
           (SELECT COUNT(*)::int FROM disbursements
             WHERE receipt_status = 'awaiting_acknowledgement' AND $1::int IS NOT NULL
               AND disbursement_date < CURRENT_DATE - ($1 * INTERVAL '1 day')) AS overdue_receipts,
           (SELECT COUNT(*)::int FROM (
             SELECT a.id FROM bursary_awards a JOIN disbursements d ON d.award_id = a.id
             WHERE a.status = 'approved' AND (d.payment_status IS NULL OR d.payment_status NOT IN ('failed', 'cancelled'))
             GROUP BY a.id, a.approved_amount
             HAVING SUM(d.amount) > 0 AND SUM(d.amount) < a.approved_amount
           ) partial) AS partial_awards,
           ((SELECT COUNT(*)::int FROM disbursements WHERE receipt_status = 'discrepancy') +
            (SELECT COUNT(*)::int FROM (
              SELECT a.id FROM bursary_awards a JOIN disbursements d ON d.award_id = a.id
              WHERE a.status = 'approved' AND (d.payment_status IS NULL OR d.payment_status NOT IN ('failed', 'cancelled'))
              GROUP BY a.id, a.approved_amount HAVING SUM(d.amount) > a.approved_amount
            ) overpaid)) AS amount_discrepancies,
           (SELECT COUNT(*)::int FROM bursary_awards WHERE status = 'submitted' AND verification_status <> 'verified') AS awards_awaiting_verification`,
        [acknowledgementOverdueDays]
      ),
    ]);

    res.json({
      totalStudents: studentCounts.rows[0].total_students,
      eligibleStudents: studentCounts.rows[0].eligible_students,
      syntheticStudents: studentCounts.rows[0].synthetic_students,
      duplicateCount: duplicateCounts.rows[0].duplicate_count,
      trend: studentTrend.rows,
      disbursementTrend: disbursementTrend.rows,
      activities: activities.rows,
      accountability: accountability.rows[0],
      acknowledgementOverdueDays,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSummary };
