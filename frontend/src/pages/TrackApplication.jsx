import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, CheckCircle2, KeyRound, Lock, Search, TriangleAlert } from "lucide-react";
import api from "../services/api";
import PublicLayout from "../components/PublicLayout";
import { Alert, Badge, Button, Card, Field, Timeline } from "../components/ui/primitives";
import { formatDate, formatDateTime, statusMeta, trackingStages } from "../lib/applicationStatus";

// The endpoint answers one message for every failure: a wrong code and a wrong date of birth look
// the same, so the page cannot be used to test whether a tracking code exists.
const EVENT_LABELS = {
  APPLICATION_SUBMITTED: "Application received",
  APPLICATION_SCREENED: "Initial checks completed",
  APPLICATION_SCREENING_FAILED: "Initial checks could not be completed",
  APPLICATION_TRIAGED: "Sent for duplicate investigation",
  APPLICATION_INVESTIGATED: "Investigation findings recorded",
  APPLICATION_DUPLICATE_RESOLVED: "Duplicate review decided",
  APPLICATION_VERIFIED: "Student record verified",
  STUDENT_CREATED: "Student record created",
};

export default function TrackApplication() {
  const [form, setForm] = useState({ tracking_code: "", date_of_birth: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setError("");
    setFieldError("");
    setResult(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.tracking_code.trim()) {
      setFieldError("Enter the tracking code shown when the application was submitted.");
      return;
    }
    if (!form.date_of_birth) {
      setFieldError("Enter the student's date of birth to confirm the code.");
      return;
    }
    setLoading(true);
    setError("");
    setFieldError("");
    setResult(null);
    try {
      const response = await api.post("/applications/track", {
        tracking_code: form.tracking_code.trim().toUpperCase(),
        date_of_birth: form.date_of_birth,
      });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.message || "No application matches that tracking code and date of birth.");
    } finally {
      setLoading(false);
    }
  }

  const application = result?.application;
  const events = result?.timeline || [];
  const meta = application ? statusMeta(application.status) : null;
  const stages = application ? trackingStages(application) : [];
  const currentStage =
    stages.find((stage) => stage.state === "blocked") ||
    stages.find((stage) => stage.state === "current") ||
    stages.find((stage) => stage.state === "pending");


  return (
    <PublicLayout cta={false}>
      <div className="sb-container sb-container--narrow" style={{ paddingTop: 32, paddingBottom: 48 }}>
        <div className="sb-stack">
          <header className="sb-stack sb-stack--tight">
            <span className="sb-eyebrow">Guardian tracking</span>
            <h1 className="sb-title">Track your application</h1>
            <p className="sb-subtitle">
              Enter the tracking code you received when the application was submitted, and the
              student's date of birth. Both are needed to protect the application.
            </p>
          </header>

          <Card title="Application lookup">
            <form onSubmit={handleSubmit} className="sb-stack" noValidate>
              <Field
                label="Tracking code"
                htmlFor="tracking_code"
                required
                error={fieldError}
                hint="Uppercase letters and digits, exactly as shown when you applied."
              >
                <input
                  id="tracking_code"
                  name="tracking_code"
                  value={form.tracking_code}
                  onChange={handleChange}
                  className="sb-input sb-code"
                  placeholder="XXXXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="characters"
                />
              </Field>

              <Field label="Student date of birth" htmlFor="date_of_birth" required hint="The same date entered on the application.">
                <input
                  id="date_of_birth"
                  type="date"
                  name="date_of_birth"
                  value={form.date_of_birth}
                  onChange={handleChange}
                  className="sb-input"
                />
              </Field>

              <div className="sb-row sb-row--between">
                <Button type="submit" variant="primary" disabled={loading}>
                  <Search size={15} aria-hidden="true" />
                  {loading ? "Checking…" : "Check status"}
                </Button>
                <Link to="/apply" className="sb-link">
                  <KeyRound size={14} aria-hidden="true" />
                  Apply instead
                </Link>
              </div>
            </form>
          </Card>

          {loading && (
            <Card title="Application status">
              <div aria-hidden="true">
                <div className="sb-skeleton sb-skeleton--title" />
                <div className="sb-skeleton sb-skeleton--line" style={{ width: "70%" }} />
                <div className="sb-skeleton sb-skeleton--line" style={{ width: "52%" }} />
              </div>
              <p className="sb-meta" role="status">
                Checking the tracking code…
              </p>
            </Card>
          )}

          {error && (
            <Alert tone="error" title="We could not find that application">
              {error} Check the code character by character and use the same date of birth as the
              application. If the code is lost, contact the bursary office with the student's UPI or
              birth certificate number.
            </Alert>
          )}

          {application && !loading && (
            <div className="sb-stack sb-animate-rise" aria-live="polite">
              <Card title="Current status" action={<Badge tone={meta.tone}>{meta.guardianLabel}</Badge>}>
                <div className="sb-stack sb-stack--tight">
                  <p className="sb-subtitle">{meta.description}</p>
                  <dl className="sb-dl sb-dl--2">
                    <div className="sb-dl__row">
                      <dt>Student</dt>
                      <dd>{application.full_name}</dd>
                    </div>
                    <div className="sb-dl__row">
                      <dt>School</dt>
                      <dd>{application.school_code}</dd>
                    </div>
                    <div className="sb-dl__row">
                      <dt>Submitted</dt>
                      <dd>{formatDate(application.submitted_at)}</dd>
                    </div>
                    <div className="sb-dl__row">
                      <dt>Last updated</dt>
                      <dd>{formatDate(application.updated_at)}</dd>
                    </div>
                  </dl>

                  {application.screening_unavailable && (
                    <Alert tone="warning" title="Screening not completed">
                      Initial duplicate checks were not completed for this application. Office staff will
                      review it manually; this is not a decision.
                    </Alert>
                  )}

                  {["rejected", "withdrawn"].includes(application.status) && (
                    <Alert tone="neutral" title={application.status === "rejected" ? "Application closed" : "Application withdrawn"}>
                      {application.closure_reason || "No reason was recorded on the public record."} Contact the
                      bursary office if you need more detail.
                    </Alert>
                  )}
                </div>
              </Card>

              <Card title="Progress">
                <Timeline
                  items={stages.map((stage, index) => ({
                    key: stage.key,
                    index: index + 1,
                    title: stage.title,
                    state: stage.state === "skipped" ? "pending" : stage.state,
                    detail: stage.state === "skipped" ? "Not required for this application." : stage.detail,
                    meta: stage.key === "submitted" ? `Submitted ${formatDate(application.submitted_at)}` : null,
                  }))}
                />
                {currentStage?.state !== "done" && (
                  <Alert tone="info" title="What happens next" icon={CalendarClock}>
                    {currentStage?.detail}
                  </Alert>
                )}
              </Card>

              {events.length > 0 && (
                <Card title="Recorded activity">
                  <ol className="sb-timeline">
                    {events.map((event, index) => (
                      <li key={`${event.action}-${event.at}-${index}`} className="sb-timeline__item sb-timeline__item--done">
                        <span className="sb-timeline__marker" aria-hidden="true">
                          <CheckCircle2 size={13} strokeWidth={3} />
                        </span>
                        <div className="sb-timeline__body">
                          <span className="sb-timeline__title">{EVENT_LABELS[event.action] || "Application updated"}</span>
                          <span className="sb-timeline__meta">{formatDateTime(event.at)}</span>
                        </div>
                      </li>
                    ))}
                  </ol>
                </Card>
              )}

              <Alert tone="info" title="Privacy on this page" icon={Lock}>
                This page never shows another applicant's information, duplicate evidence, staff notes or
                sensitive identifiers. A submitted application is not an approval.
              </Alert>
            </div>
          )}

          {!application && !error && !loading && (
            <p className="sb-meta" style={{ display: "flex", gap: 8 }}>
              <TriangleAlert size={14} aria-hidden="true" style={{ marginTop: 2, flex: "0 0 auto" }} />
              Keep the tracking code private. Anyone with the code and the student's date of birth can view
              this status.
            </p>
          )}
        </div>
      </div>
    </PublicLayout>
  );
}

