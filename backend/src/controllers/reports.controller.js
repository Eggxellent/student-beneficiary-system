const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { randomUUID } = require("crypto");
const pool = require("../config/db");
const logAudit = require("../services/auditLog");
const { acknowledgementOverdueDays } = require("../config/reconciliation");

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
      `SELECT COUNT(*) AS total_students
       FROM students
       WHERE created_at::date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    const disbursementsResult = await pool.query(
      `SELECT COUNT(*) AS total_disbursements,
              COALESCE(SUM(amount), 0) AS total_amount
       FROM disbursements
       WHERE disbursement_date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    const flagsResult = await pool.query(
      `SELECT COUNT(*) AS pending_flags
       FROM duplicate_flags
       WHERE status IN ('pending', 'needs_verification')
       AND created_at::date BETWEEN $1 AND $2`,
      [start_date, end_date]
    );

    const accountabilityResult = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM bursary_awards WHERE status = 'approved') AS approved_awards,
         (SELECT COUNT(*)::int FROM bursary_awards a WHERE a.status = 'approved'
           AND NOT EXISTS (SELECT 1 FROM disbursements d WHERE d.award_id = a.id
             AND (d.payment_status IS NULL OR d.payment_status NOT IN ('failed', 'cancelled')))) AS awards_without_payment,
         (SELECT COUNT(*)::int FROM (
           SELECT a.id FROM bursary_awards a JOIN disbursements d ON d.award_id = a.id
           WHERE a.status = 'approved' AND (d.payment_status IS NULL OR d.payment_status NOT IN ('failed', 'cancelled'))
           GROUP BY a.id, a.approved_amount
           HAVING SUM(d.amount) > 0 AND SUM(d.amount) < a.approved_amount
         ) partial) AS partial_awards,
         (SELECT COUNT(*)::int FROM bursary_awards WHERE status = 'submitted' AND verification_status <> 'verified') AS awards_awaiting_verification,
         (SELECT COUNT(*)::int FROM duplicate_flags WHERE status IN ('pending', 'needs_verification')) AS potential_duplicate_flags,
         (SELECT COUNT(*)::int FROM disbursements WHERE payment_status = 'issued') AS awaiting_clearance,
         (SELECT COUNT(*)::int FROM disbursements WHERE payment_status = 'cleared') AS cleared_payments,
         (SELECT COALESCE(SUM(amount), 0)::numeric FROM disbursements WHERE payment_status = 'cleared') AS cleared_amount,
         (SELECT COUNT(*)::int FROM disbursements WHERE receipt_status = 'awaiting_acknowledgement') AS awaiting_acknowledgement,
         (SELECT COUNT(*)::int FROM disbursements WHERE receipt_status = 'awaiting_acknowledgement'
           AND $1::int IS NOT NULL
           AND disbursement_date < CURRENT_DATE - ($1 * INTERVAL '1 day')) AS overdue_acknowledgement,
         (SELECT COUNT(*)::int FROM disbursements WHERE receipt_status = 'discrepancy') AS amount_discrepancies`,
      [acknowledgementOverdueDays]
    );

    const detailsResult = await pool.query(
      `SELECT d.disbursement_date, s.full_name, d.amount, d.status
       FROM disbursements d
       JOIN students s ON s.id = d.student_id
       WHERE d.disbursement_date BETWEEN $1 AND $2
       ORDER BY d.disbursement_date DESC`,
      [start_date, end_date]
    );

    const totalStudents = studentsResult.rows[0].total_students;
    const totalDisbursements = disbursementsResult.rows[0].total_disbursements;
    const totalAmount = disbursementsResult.rows[0].total_amount;
    const pendingFlags = flagsResult.rows[0].pending_flags;
    const accountability = accountabilityResult.rows[0];
    const reportId = randomUUID();
    const reportsDir = path.resolve(__dirname, "../../reports");

    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const fileName = `report-${reportId}.pdf`;
    const filePath = path.join(reportsDir, fileName);
    const relativeFilePath = `reports/${fileName}`;
    const doc = new PDFDocument({ margin: 50 });
    const stream = fs.createWriteStream(filePath);

    doc.pipe(stream);
    doc.fontSize(20).text("Student Beneficiary Management System", { align: "center" });
    doc.moveDown();
    doc.fontSize(16).text("Disbursement and Beneficiary Report", { align: "center" });
    doc.moveDown();
    doc.fontSize(11).text(`Report Period: ${start_date} to ${end_date}`);
    doc.text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown();
    doc.fontSize(14).text("Summary");
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Total Students Registered: ${totalStudents}`);
    doc.text(`Total Disbursements: ${totalDisbursements}`);
    doc.text(`Total Disbursed Amount: KES ${Number(totalAmount).toLocaleString()}`);
    doc.text(`Pending Duplicate Flags: ${pendingFlags}`);
    doc.moveDown();
    doc.fontSize(14).text("Accountability Snapshot");
    doc.moveDown(0.5);
    doc.fontSize(11).text(`Approved Awards: ${accountability.approved_awards}`);
    doc.text(`Awards Without Payment: ${accountability.awards_without_payment}`);
    doc.text(`Partial Awards: ${accountability.partial_awards}`);
    doc.text(`Awards Awaiting Verification: ${accountability.awards_awaiting_verification}`);
    doc.text(`Potential Duplicate Flags Awaiting Review: ${accountability.potential_duplicate_flags}`);
    doc.text(`Payments Awaiting Clearance: ${accountability.awaiting_clearance}`);
    doc.text(`Cleared Payments: ${accountability.cleared_payments}`);
    doc.text(`Cleared Amount: KES ${Number(accountability.cleared_amount).toLocaleString()}`);
    doc.text(`Awaiting Receipt Acknowledgement: ${accountability.awaiting_acknowledgement}`);
    doc.text(acknowledgementOverdueDays === null
      ? "Overdue Acknowledgements: Deadline not configured"
      : `Overdue Acknowledgements (${acknowledgementOverdueDays} days): ${accountability.overdue_acknowledgement}`);
    doc.text(`Amount Discrepancies: ${accountability.amount_discrepancies}`);
    doc.fontSize(9).text("Accountability values are a current snapshot; the report period applies to registrations, payments, and duplicate flags above.");
    doc.moveDown();
    doc.fontSize(14).text("Disbursement Details");
    doc.moveDown(0.5);

    if (detailsResult.rows.length === 0) {
      doc.fontSize(11).text("No disbursements found for this period.");
    } else {
      detailsResult.rows.forEach((item, index) => {
        doc.fontSize(10).text(
          `${index + 1}. ${item.full_name} | ${item.disbursement_date} | KES ${Number(item.amount).toLocaleString()} | ${item.status}`
        );
        doc.moveDown(0.3);
      });
    }

    doc.moveDown();
    doc.fontSize(9).text("Generated by the Student Beneficiary Management System.");
    doc.end();

    stream.on("finish", async () => {
      try {
        await pool.query(
          `INSERT INTO reports
           (id, generated_by, report_type, start_date, end_date, file_path)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [reportId, req.user.id, "disbursement_summary", start_date, end_date, relativeFilePath]
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
