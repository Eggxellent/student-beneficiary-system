import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Calculator, Info, Search, Users } from "lucide-react";
import api from "../services/api";
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader } from "../components/ui/primitives";
import { money } from "../lib/applicationStatus";

const EMPTY_FORM = {
  student_id: "",
  fee_balance: "",
  household_income: "",
  vulnerability_status: "low",
  siblings_in_school: "",
  prior_bursary_history: "none",
};

const CATEGORY_TONE = { high: "success", moderate: "warning", low: "neutral" };

export default function Eligibility() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [students, setStudents] = useState([]);
  const [studentQuery, setStudentQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [studentsError, setStudentsError] = useState("");

  useEffect(() => {
    api
      .get("/students")
      .then((response) => setStudents(Array.isArray(response.data) ? response.data : response.data?.value || []))
      .catch((err) => {
        setStudents([]);
        setStudentsError(err.response?.data?.message || "The student list could not be loaded.");
      });
  }, []);

  const visibleStudents = useMemo(() => {
    const query = studentQuery.trim().toLowerCase();
    if (!query) return students;
    return students.filter((student) =>
      [student.full_name, student.school_code, student.upi]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query))
    );
  }, [studentQuery, students]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setResult(null);
    setError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.student_id) {
      setError("Select a registered student before calculating eligibility.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/eligibility", {
        student_id: form.student_id,
        fee_balance: Number(form.fee_balance),
        household_income: Number(form.household_income),
        vulnerability_status: form.vulnerability_status,
        siblings_in_school: Number(form.siblings_in_school || 0),
        prior_bursary_history: form.prior_bursary_history,
      });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to calculate eligibility. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const canCalculate =
    Boolean(form.student_id) && form.fee_balance !== "" && form.household_income !== "" && form.siblings_in_school !== "";

  return (
    <div className="sb-stack sb-animate-rise">
      <PageHeader
        eyebrow="Eligibility"
        title="Eligibility verification"
        subtitle="Calculate the eligibility assessment for a registered student. Eligibility uses the office's defined rules; it is separate from duplicate screening and is not an award approval."
        actions={
          <Link to="/applications" className="sb-btn">
            Back to applications
          </Link>
        }
      />

      {studentsError && (
        <Alert tone="error" title="Student list unavailable">
          {studentsError} You can still calculate eligibility if the student is registered.
        </Alert>
      )}

      <div className="sb-split">
        <Card title="Eligibility information">
          <form onSubmit={handleSubmit} className="sb-stack">
            <div className="sb-panel">
              <p className="sb-label" style={{ marginBottom: 6 }}>
                Registered student
              </p>
              <div className="sb-input-group" style={{ marginBottom: 8 }}>
                <span className="sb-input-group__prefix" aria-hidden="true">
                  <Search size={14} />
                </span>
                <input
                  type="search"
                  value={studentQuery}
                  onChange={(event) => setStudentQuery(event.target.value)}
                  className="sb-input"
                  placeholder="Search by name, school or UPI"
                  aria-label="Search registered students"
                  autoComplete="off"
                />
              </div>
              <select
                value={form.student_id}
                onChange={(event) => {
                  setForm((current) => ({ ...current, student_id: event.target.value }));
                  setResult(null);
                  setError("");
                }}
                className="sb-input"
                aria-label="Select a registered student"
              >
                <option value="">Select student…</option>
                {visibleStudents.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name} — {student.school_code || "No school"}
                  </option>
                ))}
              </select>
              {students.length === 0 && !studentsError && (
                <p className="sb-hint" style={{ marginTop: 8 }}>
                  No students are registered yet. Students are created when an application is verified.
                </p>
              )}
            </div>

            <div className="sb-grid sb-grid--2">
              <Field label="Fee balance (KSh)" htmlFor="fee_balance" required>
                <input id="fee_balance" name="fee_balance" type="number" min="0" step="0.01" value={form.fee_balance} onChange={handleChange} className="sb-input" placeholder="e.g. 24000" required />
              </Field>
              <Field label="Household income (KSh)" htmlFor="household_income" required>
                <input id="household_income" name="household_income" type="number" min="0" step="0.01" value={form.household_income} onChange={handleChange} className="sb-input" placeholder="e.g. 18000" required />
              </Field>
              <Field label="Vulnerability status" htmlFor="vulnerability_status" required>
                <select id="vulnerability_status" name="vulnerability_status" value={form.vulnerability_status} onChange={handleChange} className="sb-input">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Field>
              <Field label="Siblings in school" htmlFor="siblings_in_school" required>
                <input id="siblings_in_school" name="siblings_in_school" type="number" min="0" step="1" value={form.siblings_in_school} onChange={handleChange} className="sb-input" placeholder="e.g. 2" required />
              </Field>
              <Field label="Prior bursary history" htmlFor="prior_bursary_history" required>
                <select id="prior_bursary_history" name="prior_bursary_history" value={form.prior_bursary_history} onChange={handleChange} className="sb-input">
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="high">High</option>
                </select>
              </Field>
            </div>

            {error && <Alert tone="error">{error}</Alert>}

            <div className="sb-row">
              <Button type="submit" variant="primary" disabled={loading || !canCalculate}>
                <Calculator size={15} aria-hidden="true" />
                {loading ? "Calculating…" : "Calculate eligibility"}
              </Button>
              <span className="sb-meta">The result is saved to the selected student's record.</span>
            </div>
          </form>
        </Card>


        <Card title="Assessment result">
          {!result ? (
            <EmptyState title="No result yet" icon={Calculator}>
              Choose a registered student, record the eligibility figures and calculate. The result appears
              here with its score breakdown.
            </EmptyState>
          ) : (
            <div className="sb-stack">
              <div className="sb-panel">
                <p className="sb-meta">Student</p>
                <p style={{ fontWeight: 650, color: "var(--sb-primary-dark)" }}>{result.student?.full_name}</p>
                <p className="sb-meta">
                  {result.student?.school_code || "School not recorded"} · UPI {result.student?.upi || "not recorded"}
                </p>
              </div>

              <div className="sb-grid sb-grid--2">
                <div className="sb-stat">
                  <span className="sb-stat__label">Eligibility category</span>
                  <span className="sb-stat__value">{result.category_label}</span>
                  <Badge tone={CATEGORY_TONE[result.category] || "neutral"}>{result.category}</Badge>
                </div>
                <div className="sb-stat">
                  <span className="sb-stat__label">Eligibility score</span>
                  <span className="sb-stat__value">
                    {result.score}
                    <span style={{ fontSize: 14, color: "var(--sb-muted)" }}> / {result.max_score ?? 100}</span>
                  </span>
                </div>
              </div>

              <div className="sb-panel">
                <p className="sb-label">Recommended bursary range</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: "var(--sb-primary-dark)", marginTop: 4 }}>
                  {money(result.recommended_range.min)} – {money(result.recommended_range.max)}
                </p>
                {result.recommended_range.provisional && (
                  <Badge tone="warning" className="sb-badge" style={{ marginTop: 6 }}>
                    Provisional recommendation
                  </Badge>
                )}
              </div>

              {result.recommended_range.provisional && (
                <Alert tone="warning" title="Provisional figures">
                  No approved allocation ranges are configured, so these figures are a provisional proposal —
                  not an official allocation limit. An authorised officer sets the final amount.
                </Alert>
              )}

              <div className="sb-table-wrap">
                <table className="sb-table">
                  <thead>
                    <tr>
                      <th scope="col">Factor</th>
                      <th scope="col">Recorded</th>
                      <th scope="col">Points</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.factors || []).map((factor) => (
                      <tr key={factor.key}>
                        <td className="sb-table__primary">{factor.label}</td>
                        <td className="sb-meta">{factor.detail}</td>
                        <td style={{ textAlign: "right", fontWeight: 600 }}>
                          {factor.points} / {factor.max_points}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Alert tone="info" title="Recommendation only" icon={Info}>
                {result.guidance || "An authorised administrator must approve or reject the bursary award."}
              </Alert>

              <Link to="/awards" className="sb-btn sb-btn--primary sb-btn--block">
                <Users size={15} aria-hidden="true" />
                Continue to award recommendation
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

