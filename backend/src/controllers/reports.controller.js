const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const logAudit = require("../services/auditLog");
const { createReportDocument } = require("../services/reportDocument");

async function exportReport(req, res, next) {
  try {
    const { start_date, end_date } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        message: "start_date and end_date are required",
      });
    }

    if (start_date > end_date) {
      return res.status(400).json({
        message: "start_date cannot be after end_date",
      });
    }

    const studentsResult = await pool.query(
      `SELECT COUNT(*)::int AS total_students,
              COUNT(*) FILTER (WHERE eligibility_score IS NOT NULL)::int AS assessed_students
       FROM students
       WHERE created_at::date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    const flagsResult = await pool.query(
      `SELECT COUNT(*)::int AS pending_flags
       FROM duplicate_flags
       WHERE status IN ('pending', 'needs_verification')
       AND created_at::date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    const awardsResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total_awards,
         COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_awards,
         COALESCE(SUM(approved_amount) FILTER (WHERE status = 'approved'), 0)::numeric AS approved_amount,
         COUNT(*) FILTER (WHERE status = 'rejected')::int AS rejected_awards,
         COUNT(*) FILTER (WHERE status = 'submitted')::int AS submitted_awards,
         COALESCE(SUM(requested_amount) FILTER (WHERE status = 'submitted'), 0)::numeric AS pending_amount,
         COALESCE(SUM(requested_amount), 0)::numeric AS requested_amount,
         COUNT(*) FILTER (WHERE status = 'submitted' AND verification_status <> 'verified')::int AS awaiting_verification
       FROM bursary_awards
       WHERE created_at::date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    const detailsResult = await pool.query(
      `SELECT a.decided_at, s.full_name, s.school_code, s.eligibility_category,
              a.status, a.approved_amount
       FROM bursary_awards a
       JOIN students s ON s.id = a.student_id
       WHERE a.decided_at IS NOT NULL
         AND a.decided_at::date BETWEEN $1 AND $2
       ORDER BY a.decided_at ASC
       LIMIT 500`,
      [start_date, end_date]
    );

    const actorResult = await pool.query(
      `SELECT full_name FROM users WHERE id = $1`,
      [req.user.id]
    );

    const totalStudents = studentsResult.rows[0].total_students;
    const assessedStudents = studentsResult.rows[0].assessed_students;
    const pendingFlags = flagsResult.rows[0].pending_flags;
    const awards = awardsResult.rows[0];
    const reportId = randomUUID();
    const fileName = `sbms-report-${start_date}-to-${end_date}-${Date.now()}.pdf`;
    const reportsDir = path.join(__dirname, "..", "..", "reports");
    fs.mkdirSync(reportsDir, { recursive: true });
    const filePath = path.join(reportsDir, fileName);
    const relativeFilePath = `reports/${fileName}`;

    const doc = createReportDocument({
      reportId,
      period: { start_date, end_date },
      generatedAt: new Date(),
      preparedBy: actorResult.rows[0]?.full_name || "an authorised system user",
      summary: {
        studentsRegistered: totalStudents,
        studentsAssessed: assessedStudents,
        duplicateFlags: pendingFlags,
        totalAwards: awards.total_awards,
        approvedAwards: awards.approved_awards,
        approvedAmount: awards.approved_amount,
        rejectedAwards: awards.rejected_awards,
        awaitingDecision: awards.submitted_awards,
        awaitingVerification: awards.awaiting_verification,
        requestedAmount: awards.requested_amount,
        pendingAmount: awards.pending_amount,
      },
      decisions: detailsResult.rows,
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.end();

    stream.on("finish", async () => {
      try {
        await pool.query(
          `INSERT INTO reports
           (id, generated_by, report_type, start_date, end_date, file_path)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [reportId, req.user.id, "beneficiary_award_summary", start_date, end_date, relativeFilePath]
        );
        await logAudit(req.user.id, "GENERATE_REPORT", "reports", reportId);
        res.download(filePath, fileName, (error) => {
          if (error) next(error);
        });
      } catch (error) {
        next(error);
      }
    });

    stream.on("error", next);
  } catch (error) {
    next(error);
  }
}

module.exports = { exportReport };
