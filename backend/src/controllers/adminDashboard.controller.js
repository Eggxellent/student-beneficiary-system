const pool = require('../config/db');

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
    const [studentCounts, duplicateCounts, studentTrend, disbursementTrend, activities] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_students,
          COUNT(*) FILTER (WHERE eligibility_category IN ('eligible', 'highly_eligible'))::int AS eligible_students,
          COUNT(*) FILTER (WHERE is_synthetic)::int AS synthetic_students
        FROM students
      `),
      pool.query("SELECT COUNT(*)::int AS duplicate_count FROM duplicate_flags WHERE status = 'pending'"),
      pool.query(monthlyTrendQuery('students', 'created_at')),
      pool.query(monthlyTrendQuery('disbursements', 'disbursement_date::timestamp')),
      pool.query('SELECT id, action, created_at FROM audit_logs ORDER BY created_at DESC LIMIT 4'),
    ]);

    res.json({
      totalStudents: studentCounts.rows[0].total_students,
      eligibleStudents: studentCounts.rows[0].eligible_students,
      syntheticStudents: studentCounts.rows[0].synthetic_students,
      duplicateCount: duplicateCounts.rows[0].duplicate_count,
      trend: studentTrend.rows,
      disbursementTrend: disbursementTrend.rows,
      activities: activities.rows,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSummary };
