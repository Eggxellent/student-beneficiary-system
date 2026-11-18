import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Award, FileWarning, Send } from "lucide-react";
import api from "../../services/api";
import { useAuth } from "../../context/AuthContext";
import AwardCertificatePanel from "../../components/AwardCertificatePanel";
import { Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Skeleton } from "../../components/ui/primitives";
import { awardMeta, formatDate, money } from "../../lib/applicationStatus";

const EMPTY_AWARD = { student_id: "", requested_amount: "" };
const EMPTY_REPORT = { award_id: "", reason: "" };

const FILTERS = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Awaiting decision" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "voided", label: "Voided" },
];

export default function AwardRecommendations() {
  const { user } = useAuth();
  const [awards, setAwards] = useState([]);
  const [students, setStudents] = useState([]);
  const [awardForm, setAwardForm] = useState(EMPTY_AWARD);
  const [reportForm, setReportForm] = useState(EMPTY_REPORT);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const submittingRef = useRef(false);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const [awardsResponse, studentsResponse] = await Promise.all([api.get("/awards"), api.get("/students")]);
      setAwards(awardsResponse.data.awards || []);
      setStudents(Array.isArray(studentsResponse.data) ? studentsResponse.data : studentsResponse.data?.value || []);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load awards.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const currentYear = new Date().getFullYear();
  // One bursary per student per calendar year. A proposal or an approval occupies the year; a rejected
  // or voided award does not. The API enforces the same rule; this copy avoids a pointless request.
  const awardedStudentIds = new Set(
    awards
      .filter((award) => ["submitted", "approved"].includes(award.status) && Number(award.award_year) === currentYear)
      .map((award) => award.student_id)
  );

  const reportableAwards = awards.filter(
    (award) => ["submitted", "approved"].includes(award.status) && award.submitted_by === user?.id
  );

  const counts = {
    total: awards.length,
    awaiting: awards.filter((award) => award.status === "submitted").length,
    approved: awards.filter((award) => award.status === "approved").length,
    rejected: awards.filter((award) => award.status === "rejected").length,
  };

  const visibleAwards = filter === "all" ? awards : awards.filter((award) => award.status === filter);

  const selectedStudent = students.find((student) => student.id === awardForm.student_id) || null;
  const alreadyAwarded = awardForm.student_id ? awardedStudentIds.has(awardForm.student_id) : false;

  function openConfirmation(event) {
    event.preventDefault();
    if (!awardForm.student_id || !awardForm.requested_amount) return;
    setConfirmOpen(true);
  }

  async function submitAward() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await api.post("/awards", awardForm);
      setMessage(response.data.message || "Award recommendation submitted. An administrator decides.");
      setAwardForm(EMPTY_AWARD);
      setConfirmOpen(false);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to submit the award recommendation.");
      setConfirmOpen(false);
    } finally {
      submittingRef.current = false;
      setSaving(false);
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await api.post(`/awards/${reportForm.award_id}/error-report`, { reason: reportForm.reason });
      setMessage(response.data.message || "The error was reported.");
      setReportForm(EMPTY_REPORT);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to report the error.");
    } finally {
      setSaving(false);
    }
  }


  return (
    <div className="sb-stack sb-animate-rise">
      <PageHeader
        eyebrow="Awards"
        title="Award recommendations"
        subtitle={`Propose a bursary amount for a registered student. A Field Officer recommends; an administrator decides. One bursary per student per calendar year (${currentYear}). An approved award is not a payment.`}
        actions={
          <Link to="/eligibility" className="sb-btn">
            Eligibility verification
          </Link>
        }
      />

      {error && (
        <Alert tone="error" title="Action not completed">
          {error}
        </Alert>
      )}
      {message && (
        <Alert tone="success" title="Recorded">
          {message}
        </Alert>
      )}

      <div className="sb-grid sb-grid--4">
        <div className="sb-stat">
          <span className="sb-stat__label">Awards shown</span>
          <span className="sb-stat__value">{counts.total}</span>
        </div>
        <div className="sb-stat sb-stat--warning">
          <span className="sb-stat__label">Awaiting admin decision</span>
          <span className="sb-stat__value">{counts.awaiting}</span>
        </div>
        <div className="sb-stat sb-stat--success">
          <span className="sb-stat__label">Approved</span>
          <span className="sb-stat__value">{counts.approved}</span>
        </div>
        <div className="sb-stat">
          <span className="sb-stat__label">Rejected</span>
          <span className="sb-stat__value">{counts.rejected}</span>
        </div>
      </div>

      <Card title="Propose an award">
        <form onSubmit={openConfirmation} className="sb-stack">
          <Alert tone="info" title="A recommendation is not an approval">
            The administrator makes the final award decision. An approved award is not a payment.
          </Alert>

          <div className="sb-grid sb-grid--3">
            <Field label="Student" htmlFor="student_id" required hint="Students appear here after an application is verified.">
              <select
                id="student_id"
                value={awardForm.student_id}
                onChange={(event) => setAwardForm({ ...awardForm, student_id: event.target.value })}
                className="sb-input"
                required
              >
                <option value="">Select student…</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id} disabled={awardedStudentIds.has(student.id)}>
                    {student.full_name} — {student.school_code || "No school"}
                    {awardedStudentIds.has(student.id) ? ` (bursary already recorded for ${currentYear})` : ""}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Proposed amount (KSh)" htmlFor="requested_amount" required hint="The administrator may approve a different amount.">
              <input
                id="requested_amount"
                type="number"
                min="0.01"
                step="0.01"
                required
                value={awardForm.requested_amount}
                onChange={(event) => setAwardForm({ ...awardForm, requested_amount: event.target.value })}
                className="sb-input"
                placeholder="e.g. 15000"
              />
            </Field>

            <div className="sb-field" style={{ justifyContent: "flex-end" }}>
              <Button
                type="submit"
                variant="primary"
                disabled={saving || alreadyAwarded || !awardForm.student_id || !awardForm.requested_amount}
              >
                <Send size={15} aria-hidden="true" />
                Review recommendation
              </Button>
            </div>
          </div>

          {alreadyAwarded && (
            <Alert tone="warning" title="Bursary already recorded">
              This student already has a proposal or an approved award for {currentYear}. Report an error on
              the existing award instead of creating a second one.
            </Alert>
          )}

          {students.length === 0 && !loading && (
            <p className="sb-hint">No students are registered yet, so there is nobody to recommend an award for.</p>
          )}
        </form>
      </Card>

      <Card title="Report an error on an award">
        <form onSubmit={submitReport} className="sb-stack">
          <p className="sb-subtitle">
            Report a factual error on an award you submitted. The administrator reviews reports; a report
            does not change the award by itself.
          </p>
          <div className="sb-grid sb-grid--2">
            <Field label="Award" htmlFor="report_award" required>
              <select
                id="report_award"
                value={reportForm.award_id}
                onChange={(event) => setReportForm({ ...reportForm, award_id: event.target.value })}
                className="sb-input"
                required
                disabled={reportableAwards.length === 0}
              >
                <option value="">Select award…</option>
                {reportableAwards.map((award) => (
                  <option key={award.id} value={award.id}>
                    {award.student_name} — {money(award.requested_amount)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="What is wrong?" htmlFor="report_reason" required>
              <textarea
                id="report_reason"
                rows={2}
                minLength={5}
                maxLength={2000}
                required
                value={reportForm.reason}
                onChange={(event) => setReportForm({ ...reportForm, reason: event.target.value })}
                className="sb-input"
                placeholder="Describe the error and the correct record."
                disabled={reportableAwards.length === 0}
              />
            </Field>
          </div>
          <div className="sb-row">
            <Button type="submit" disabled={saving || reportableAwards.length === 0 || !reportForm.award_id}>
              <FileWarning size={15} aria-hidden="true" />
              Submit error report
            </Button>
            {reportableAwards.length === 0 && (
              <span className="sb-meta">No award you submitted is open for an error report.</span>
            )}
          </div>
        </form>
      </Card>

      <Card
        title="Award records"
        action={
          <div className="sb-row" style={{ gap: 6 }}>
            {FILTERS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setFilter(option.id)}
                className={`sb-btn sb-btn--sm ${filter === option.id ? "sb-btn--primary" : ""}`}
                aria-pressed={filter === option.id}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        {loading ? (
          <Skeleton lines={4} />
        ) : visibleAwards.length === 0 ? (
          <EmptyState title="No award records" icon={Award}>
            Awards appear here after a recommendation is submitted.
          </EmptyState>
        ) : (
          <div className="sb-table-wrap">
            <table className="sb-table">
              <thead>
                <tr>
                  <th scope="col">Student</th>
                  <th scope="col">Proposed</th>
                  <th scope="col">Approved</th>
                  <th scope="col">Status</th>
                  <th scope="col">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {visibleAwards.map((award) => {
                  const meta = awardMeta(award.status);
                  return (
                    <tr key={award.id}>
                      <td>
                        <span className="sb-table__primary">{award.student_name}</span>
                        <span className="sb-table__sub">{award.school_code || "School not recorded"}</span>
                      </td>
                      <td>{money(award.requested_amount)}</td>
                      <td>{award.approved_amount == null ? "—" : money(award.approved_amount)}</td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {award.open_report_id && <span className="sb-table__sub">error reported</span>}
                      </td>
                      <td>{formatDate(award.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={confirmOpen}
        title="Submit this recommendation?"
        onClose={() => setConfirmOpen(false)}
        actions={
          <>
            <Button onClick={() => setConfirmOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" onClick={submitAward} disabled={saving}>
              {saving ? "Submitting…" : "Confirm recommendation"}
            </Button>
          </>
        }
      >
        <p className="sb-subtitle">
          {selectedStudent?.full_name || "Selected student"} · proposed {money(awardForm.requested_amount)}
        </p>
        <p className="sb-meta">
          The administrator decides the award. The recommendation is recorded against the award record and
          the audit log.
        </p>
      </Modal>

      <Card title="Bursary certificates">
        <p className="sb-subtitle" style={{ marginBottom: 12 }}>
          A bursary certificate is issued only for an approved award. Print or save it as a PDF; the QR code
          links to the public verification page.
        </p>
        <AwardCertificatePanel awards={awards} isAdmin={false} currentUserId={user?.id} />
      </Card>
    </div>
  );
}
