import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Loader2,
  Search,
  ShieldCheck,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import api from "../services/api";
import PublicLayout from "../components/PublicLayout";
import { Alert, Badge, Button, Card, Field, Stepper } from "../components/ui/primitives";
import { formatDate } from "../lib/applicationStatus";

const EMPTY_FORM = {
  full_name: "",
  date_of_birth: "",
  school_code: "",
  guardian_name: "",
  guardian_phone: "",
  guardian_email: "",
  relationship_to_student: "",
  upi: "",
  birth_certificate_number: "",
  national_id_number: "",
};

const STEPS = ["Details", "Review", "Tracking code"];

// The backend is authoritative for every rule below. These checks exist so a guardian corrects a
// typo before a round trip, not so the browser can be trusted: the API re-validates the same form.
function validate(form) {
  const errors = {};
  if (form.full_name.trim().length < 2) errors.full_name = "Enter the student's full name as it appears on school records.";
  if (!form.date_of_birth) errors.date_of_birth = "Enter the student's date of birth.";
  else if (new Date(form.date_of_birth) > new Date()) errors.date_of_birth = "The date of birth cannot be in the future.";
  if (!form.school_code) errors.school_code = "Choose the student's school.";
  if (form.guardian_name.trim().length < 2) errors.guardian_name = "Enter the guardian's full name.";
  if (!/^[17]\d{8}$/.test(form.guardian_phone)) errors.guardian_phone = "Enter the 9 digits after +254, e.g. 712345678.";
  if (form.guardian_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.guardian_email.trim())) {
    errors.guardian_email = "Enter a valid email address, or leave the field empty.";
  }
  if (!form.upi.trim() && !form.birth_certificate_number.trim() && !form.national_id_number.trim()) {
    errors.upi = "Provide at least one identifier: UPI, birth certificate number or national ID.";
  }
  return errors;
}

function ReviewRow({ label, value }) {
  return (
    <div className="sb-dl__row">
      <dt>{label}</dt>
      <dd>{value || "Not provided"}</dd>
    </div>
  );
}
export default function Apply() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [schools, setSchools] = useState([]);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [stage, setStage] = useState("form");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api
      .get("/applications/schools")
      .then(({ data }) => setSchools(data.schools || []))
      .catch(() => setSchools([]));
  }, []);

  const visibleSchools = useMemo(() => {
    const query = schoolQuery.trim().toLowerCase();
    if (!query) return schools;
    return schools.filter((school) => String(school).toLowerCase().includes(query));
  }, [schoolQuery, schools]);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: "" }));
    setError("");
  }

  function handlePhoneChange(event) {
    const digits = event.target.value.replace(/\D/g, "").replace(/^254/, "").replace(/^0/, "").slice(0, 9);
    setForm((current) => ({ ...current, guardian_phone: digits }));
    setFieldErrors((current) => ({ ...current, guardian_phone: "" }));
  }

  function review(event) {
    event.preventDefault();
    const errors = validate(form);
    setFieldErrors(errors);
    setError("");
    if (Object.keys(errors).length > 0) {
      setError("Check the highlighted fields before continuing.");
      return;
    }
    setStage("review");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        full_name: form.full_name.trim(),
        date_of_birth: form.date_of_birth,
        school_code: form.school_code,
        guardian_name: form.guardian_name.trim(),
        guardian_phone: `+254${form.guardian_phone}`,
        ...(form.guardian_email.trim() ? { guardian_email: form.guardian_email.trim() } : {}),
        ...(form.relationship_to_student.trim() ? { relationship_to_student: form.relationship_to_student.trim() } : {}),
        ...(form.upi.trim() ? { upi: form.upi.trim().toUpperCase() } : {}),
        ...(form.birth_certificate_number.trim() ? { birth_certificate_number: form.birth_certificate_number.trim().toUpperCase() } : {}),
        ...(form.national_id_number.trim() ? { national_id_number: form.national_id_number.trim() } : {}),
      };
      const response = await api.post("/applications", payload);
      setResult(response.data);
      setStage("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const body = err.response?.data;
      const flattened = body?.errors?.fieldErrors || {};
      const mapped = {};
      for (const [key, messages] of Object.entries(flattened)) {
        if (Array.isArray(messages) && messages.length) mapped[key] = messages[0];
      }
      setFieldErrors(mapped);
      setError(body?.message || "The application could not be submitted. Please check the details and try again.");
      setStage("form");
    } finally {
      setSubmitting(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(result.tracking_code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function startAnother() {
    setForm(EMPTY_FORM);
    setSchoolQuery("");
    setFieldErrors({});
    setResult(null);
    setCopied(false);
    setStage("form");
  }

  const inputClass = (name) => `sb-input${fieldErrors[name] ? " sb-input--error" : ""}`;

  const screening = result?.application?.screening || {};
  const resultState = !result
    ? null
    : screening.failure_code
      ? "unavailable"
      : Number(screening.cases_opened) > 0
        ? "review"
        : "received";

  return (
    <PublicLayout>
      <div className="sb-container sb-container--narrow" style={{ paddingTop: 32, paddingBottom: 48 }}>
        <div className="sb-stack">
          <header className="sb-stack sb-stack--tight">
            <span className="sb-eyebrow">Bursary application</span>
            <h1 className="sb-title">Apply for a bursary</h1>
            <p className="sb-subtitle">
              Apply on behalf of a student without creating an account. The office checks the details
              against existing beneficiaries before a student record is created, so please copy the
              identifiers printed on the student's documents.
            </p>
          </header>

          <Stepper steps={STEPS} current={stage === "form" ? 0 : stage === "review" ? 1 : 2} />

          {stage === "done" && result && (
            <div className="sb-animate-rise sb-stack">
              {resultState === "received" && (
                <Alert tone="success" title="Application received">
                  The application was received and identity screening is complete. Keep the tracking
                  code below: it is shown once and is the only way to follow this application.
                </Alert>
              )}

              {resultState === "review" && (
                <Alert tone="warning" title="Application received — additional identity review" icon={TriangleAlert}>
                  The details matched a possible existing beneficiary record, so the application needs a
                  further identity review. <strong>This does not mean the application was rejected.</strong>{" "}
                  A staff member reviews the case before any student record is created.
                </Alert>
              )}

              {resultState === "unavailable" && (
                <Alert tone="warning" title="Application received — screening pending" icon={WifiOff}>
                  The application was received, but identity screening could not be completed yet. It has
                  <strong> not</strong> passed duplicate screening. Office staff will review it manually;
                  this is not a decision.
                </Alert>
              )}

              <Card title="Your tracking details">
                <div className="sb-panel" style={{ textAlign: "center", padding: 22 }}>
                  <p className="sb-meta">Tracking code</p>
                  <p className="sb-code" style={{ fontSize: 22, fontWeight: 700, margin: "6px 0 12px", wordBreak: "break-all" }}>
                    {result.tracking_code}
                  </p>
                  <Button variant="primary" size="sm" onClick={copyCode}>
                    <Copy size={14} aria-hidden="true" />
                    {copied ? "Copied" : "Copy tracking code"}
                  </Button>
                </div>

                <dl className="sb-dl sb-dl--2" style={{ marginTop: 18 }}>
                  <ReviewRow label="Application reference" value={result.application?.id} />
                  <ReviewRow label="Status" value={result.message ? "Received" : "Received"} />
                  <ReviewRow label="Student" value={form.full_name.trim()} />
                  <ReviewRow label="School" value={result.application?.school_code || form.school_code} />
                  <ReviewRow label="Submitted" value={formatDate(result.application?.submitted_at)} />
                </dl>

                <Alert tone="info" title="Keep this code safe">
                  Write the code down or print this page. The office cannot recover it; if it is lost,
                  contact the bursary office with the student's UPI or birth certificate number.
                </Alert>
              </Card>

              <div className="sb-row">
                <Link to="/apply/track" className="sb-btn sb-btn--primary">
                  Track this application
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <Button onClick={startAnother}>Start another application</Button>
              </div>
            </div>
          )}

          {stage !== "done" && (
            <Card
              title={stage === "form" ? "Student and guardian details" : "Check before submitting"}
              bodyClassName="sb-card__body sb-stack"
            >
              {error && <Alert tone="error">{error}</Alert>}

              {stage === "form" && (
                <form onSubmit={review} className="sb-stack" noValidate>
                  <fieldset className="sb-fieldset">
                    <legend className="sb-fieldset__legend">Student information</legend>

                    <Field label="Student full name" htmlFor="full_name" required error={fieldErrors.full_name} hint="As printed on school records.">
                      <input
                        id="full_name"
                        name="full_name"
                        value={form.full_name}
                        onChange={handleChange}
                        maxLength={255}
                        className={inputClass("full_name")}
                        placeholder="e.g. Amina Wanjiku Otieno"
                        autoComplete="off"
                        aria-invalid={Boolean(fieldErrors.full_name)}
                      />
                    </Field>

                    <div className="sb-grid sb-grid--2">
                      <Field label="Date of birth" htmlFor="date_of_birth" required error={fieldErrors.date_of_birth}>
                        <input
                          id="date_of_birth"
                          type="date"
                          name="date_of_birth"
                          value={form.date_of_birth}
                          onChange={handleChange}
                          className={inputClass("date_of_birth")}
                          aria-invalid={Boolean(fieldErrors.date_of_birth)}
                        />
                      </Field>

                      <Field label="School" htmlFor="school_code" required error={fieldErrors.school_code} hint="Search the approved school list, then choose the school.">
                        <div className="sb-input-group" style={{ marginBottom: 8 }}>
                          <span className="sb-input-group__prefix" aria-hidden="true">
                            <Search size={14} />
                          </span>
                          <input
                            type="search"
                            value={schoolQuery}
                            onChange={(event) => setSchoolQuery(event.target.value)}
                            className="sb-input"
                            placeholder="Search schools"
                            aria-label="Search the approved school list"
                            autoComplete="off"
                          />
                        </div>
                        <select
                          id="school_code"
                          name="school_code"
                          value={form.school_code}
                          onChange={handleChange}
                          className={inputClass("school_code")}
                          aria-invalid={Boolean(fieldErrors.school_code)}
                        >
                          <option value="" disabled>
                            Choose school…
                          </option>
                          {visibleSchools.map((school) => (
                            <option key={school} value={school}>
                              {school}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <div className="sb-panel">
                      <p className="sb-label" style={{ marginBottom: 4 }}>
                        Student identifiers
                      </p>
                      <p className="sb-hint" style={{ marginBottom: 12 }}>
                        Provide at least one identifier from the student's documents. A missing
                        identifier is never treated as a match; it simply gives the office less to check.
                      </p>
                      <div className="sb-grid sb-grid--3">
                        <Field label="UPI" htmlFor="upi" error={fieldErrors.upi}>
                          <input id="upi" name="upi" value={form.upi} onChange={handleChange} maxLength={100} className={inputClass("upi")} placeholder="UPI-123" autoComplete="off" />
                        </Field>
                        <Field label="Birth certificate" htmlFor="birth_certificate_number" error={fieldErrors.birth_certificate_number}>
                          <input id="birth_certificate_number" name="birth_certificate_number" value={form.birth_certificate_number} onChange={handleChange} maxLength={100} className={inputClass("birth_certificate_number")} placeholder="BC-123" autoComplete="off" />
                        </Field>
                        <Field label="National ID" htmlFor="national_id_number" error={fieldErrors.national_id_number}>
                          <input id="national_id_number" name="national_id_number" value={form.national_id_number} onChange={handleChange} maxLength={100} className={inputClass("national_id_number")} placeholder="12345678" autoComplete="off" />
                        </Field>
                      </div>
                    </div>
                  </fieldset>

                  <hr className="sb-divider" />

                  <fieldset className="sb-fieldset">
                    <legend className="sb-fieldset__legend">Guardian information</legend>

                    <div className="sb-grid sb-grid--2">
                      <Field label="Guardian full name" htmlFor="guardian_name" required error={fieldErrors.guardian_name}>
                        <input
                          id="guardian_name"
                          name="guardian_name"
                          value={form.guardian_name}
                          onChange={handleChange}
                          maxLength={255}
                          className={inputClass("guardian_name")}
                          placeholder="Parent or guardian"
                          autoComplete="off"
                          aria-invalid={Boolean(fieldErrors.guardian_name)}
                        />
                      </Field>

                      <Field label="Phone number" htmlFor="guardian_phone" required error={fieldErrors.guardian_phone} hint="Safaricom or Airtel mobile number.">
                        <span className="sb-input-group">
                          <span className="sb-input-group__prefix">+254</span>
                          <input
                            id="guardian_phone"
                            type="tel"
                            name="guardian_phone"
                            inputMode="numeric"
                            value={form.guardian_phone}
                            onChange={handlePhoneChange}
                            maxLength={9}
                            className={inputClass("guardian_phone")}
                            placeholder="712345678"
                            autoComplete="off"
                            aria-invalid={Boolean(fieldErrors.guardian_phone)}
                          />
                        </span>
                      </Field>

                      <Field label="Email" htmlFor="guardian_email" optional error={fieldErrors.guardian_email}>
                        <input id="guardian_email" type="email" name="guardian_email" value={form.guardian_email} onChange={handleChange} maxLength={255} className={inputClass("guardian_email")} placeholder="name@example.com" autoComplete="off" />
                      </Field>

                      <Field label="Relationship to student" htmlFor="relationship_to_student" optional>
                        <input id="relationship_to_student" name="relationship_to_student" value={form.relationship_to_student} onChange={handleChange} maxLength={50} className={inputClass("relationship_to_student")} placeholder="Mother, father, aunt…" autoComplete="off" />
                      </Field>
                    </div>
                  </fieldset>

                  <Alert tone="info" title="How these details are used" icon={ShieldCheck}>
                    Information is used to process this application, including duplicate screening
                    against existing beneficiary records. Approval of an award is decided by the office,
                    not by this form.
                  </Alert>

                  <div className="sb-row sb-row--between">
                    <Button type="submit" variant="primary" size="lg">
                      Review application
                      <ArrowRight size={15} aria-hidden="true" />
                    </Button>
                    <p className="sb-meta">Step 1 of 3 · nothing has been submitted yet</p>
                  </div>
                </form>
              )}

              {stage === "review" && (
                <div className="sb-stack">
                  <dl className="sb-dl sb-dl--2">
                    <ReviewRow label="Student" value={form.full_name.trim()} />
                    <ReviewRow label="Date of birth" value={form.date_of_birth} />
                    <ReviewRow label="School" value={form.school_code} />
                    <ReviewRow label="UPI" value={form.upi.trim().toUpperCase()} />
                    <ReviewRow label="Birth certificate" value={form.birth_certificate_number.trim().toUpperCase()} />
                    <ReviewRow label="National ID" value={form.national_id_number.trim()} />
                    <ReviewRow label="Guardian" value={form.guardian_name.trim()} />
                    <ReviewRow label="Guardian phone" value={`+254${form.guardian_phone}`} />
                    <ReviewRow label="Guardian email" value={form.guardian_email.trim()} />
                    <ReviewRow label="Relationship" value={form.relationship_to_student.trim()} />
                  </dl>

                  <Alert tone="warning" title="Check these details before submitting">
                    Submitting sends these details to the bursary office. If a possible existing
                    beneficiary is found, a staff member reviews the case before any student record is
                    created; the application is not rejected automatically.
                  </Alert>

                  {submitting && (
                    <Alert tone="info" title="Checking the student details">
                      <span className="sb-row" style={{ gap: 8 }}>
                        <Loader2 size={15} className="sb-spin" aria-hidden="true" />
                        Screening may take a few moments. Please keep this page open.
                      </span>
                    </Alert>
                  )}

                  <div className="sb-row sb-row--between">
                    <Button onClick={() => setStage("form")} disabled={submitting}>
                      <ArrowLeft size={15} aria-hidden="true" />
                      Edit details
                    </Button>
                    <Button variant="primary" size="lg" onClick={submit} disabled={submitting}>
                      {submitting ? "Screening student details…" : "Confirm and submit"}
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          <p className="sb-meta" style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <CheckCircle2 size={14} aria-hidden="true" style={{ marginTop: 2, flex: "0 0 auto" }} />
            This form collects only what the bursary office needs to identify the student and reach the
            guardian. Approval of an award is decided by the office, not by this form.
          </p>
        </div>
      </div>
    </PublicLayout>
  );
}





