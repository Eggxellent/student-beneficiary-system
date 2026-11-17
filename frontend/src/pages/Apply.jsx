import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, GraduationCap, ShieldCheck } from "lucide-react";
import api from "../services/api";

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

const fieldClass =
  "mt-2 h-11 w-full border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#0E6E6B] focus:bg-white";

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

function PublicHeader() {
  return (
    <header className="border-b border-[#E4EAEE] bg-white">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
        <Link to="/" className="flex items-center gap-2 text-sm font-bold tracking-[0.14em] text-[#0B2239]">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0B2239] text-[#C8A45D]">
            <GraduationCap size={17} aria-hidden="true" />
          </span>
          SBMS
        </Link>
        <nav className="flex items-center gap-5 text-xs font-semibold text-[#46545F]" aria-label="Application links">
          <Link to="/apply" className="text-[#0B2239]">Apply</Link>
          <Link to="/apply/track" className="hover:text-[#0B2239]">Track an application</Link>
          <Link to="/verify-certificate" className="hover:text-[#0B2239]">Verify a document</Link>
          <Link to="/login" className="hover:text-[#0B2239]">Staff login</Link>
        </nav>
      </div>
    </header>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium text-slate-900">{value || "Not provided"}</dd>
    </div>
  );
}

export default function Apply() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [schools, setSchools] = useState([]);
  const [stage, setStage] = useState("form");
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get("/applications/schools")
      .then(({ data }) => setSchools(data.schools || []))
      .catch(() => setSchools([]));
  }, []);

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
    setFieldErrors({});
    setResult(null);
    setCopied(false);
    setStage("form");
  }

  const inputClass = (name) => `${fieldClass}${fieldErrors[name] ? " border-red-400 bg-red-50" : ""}`;
  const errorText = (name) => (fieldErrors[name]
    ? <span className="mt-1 block text-[11px] font-semibold text-red-600" role="alert">{fieldErrors[name]}</span>
    : null);

  return (
    <div className="min-h-screen bg-[#F7F9FA] text-[#12293F]">
      <PublicHeader />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
        <header>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E6E6B]">Bursary application</p>
          <h1 className="mt-3 text-2xl font-bold text-[#0B2239] sm:text-3xl">Apply for a bursary</h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#4E5C66]">
            Apply on behalf of a student without creating an account. The office checks the details against
            existing beneficiaries before a student record is created, so please use the identifiers printed on
            the student&apos;s documents. You will receive a tracking code once: keep it safe.
          </p>
        </header>

        {stage === "done" && result && (
          <section className="mt-8 border border-[#0E6E6B]/30 bg-white p-6" role="status">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={22} className="mt-0.5 shrink-0 text-[#0E6E6B]" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-[#0B2239]">Application received</h2>
                <p className="mt-1 text-sm text-[#4E5C66]">
                  Keep the tracking code below. It is shown once and is the only way to follow this application.
                </p>
              </div>
            </div>

            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="border border-slate-200 p-3">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Tracking code</dt>
                <dd className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-lg font-bold tracking-[0.14em] text-[#0B2239]">{result.tracking_code}</span>
                  <button type="button" onClick={copyCode} className="inline-flex items-center gap-1 border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-slate-500">
                    <Copy size={12} aria-hidden="true" /> {copied ? "Copied" : "Copy"}
                  </button>
                </dd>
              </div>
              <div className="border border-slate-200 p-3">
                <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Application reference</dt>
                <dd className="mt-1 break-all font-mono text-xs text-slate-800">{result.application?.id}</dd>
              </div>
            </dl>

            <p className="mt-4 text-xs leading-relaxed text-[#5C6B78]">
              Write the code down or print this page. The office cannot recover it; if it is lost, contact the
              bursary office with the student&apos;s UPI or birth certificate number.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              <Link to="/apply/track" className="inline-flex items-center gap-2 bg-[#0B2239] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#12293F]">
                Track this application <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <button type="button" onClick={startAnother} className="border border-[#C8D4DA] bg-white px-4 py-2.5 text-sm font-semibold text-[#0B2239] hover:border-[#0B2239]/40">
                Start another application
              </button>
            </div>
          </section>
        )}

        {stage !== "done" && (
          <section className="mt-8 border border-slate-300 bg-white">
            <div className="border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                {stage === "form" ? "1. Student and guardian details" : "2. Check before submitting"}
              </h2>
            </div>

            {error && <div className="m-5 border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}

            {stage === "form" && (
              <form onSubmit={review} className="space-y-6 px-5 py-6">
                <fieldset>
                  <legend className="text-[11px] font-bold uppercase tracking-wide text-[#0B2239]">About the student</legend>
                  <div className="mt-3">
                    <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Full name
                      <input name="full_name" value={form.full_name} onChange={handleChange} maxLength={255} className={inputClass("full_name")} placeholder="As printed on school records" required autoComplete="off" />
                    </label>
                    {errorText("full_name")}
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Date of birth
                        <input type="date" name="date_of_birth" value={form.date_of_birth} onChange={handleChange} className={inputClass("date_of_birth")} required />
                      </label>
                      {errorText("date_of_birth")}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">School
                        <select name="school_code" value={form.school_code} onChange={handleChange} className={inputClass("school_code")} required>
                          <option value="" disabled>Choose school...</option>
                          {schools.map((school) => <option key={school} value={school}>{school}</option>)}
                        </select>
                      </label>
                      {errorText("school_code")}
                    </div>
                  </div>

                  <p className="mt-4 text-xs text-[#5C6B78]">
                    Provide at least one identifier from the student&apos;s documents. A missing identifier is never treated
                    as a match; it simply gives the office less to check.
                  </p>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">UPI
                        <input name="upi" value={form.upi} onChange={handleChange} maxLength={100} className={inputClass("upi")} placeholder="UPI-123" autoComplete="off" />
                      </label>
                      {errorText("upi")}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Birth certificate
                        <input name="birth_certificate_number" value={form.birth_certificate_number} onChange={handleChange} maxLength={100} className={inputClass("birth_certificate_number")} placeholder="BC-123" autoComplete="off" />
                      </label>
                      {errorText("birth_certificate_number")}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">National ID
                        <input name="national_id_number" value={form.national_id_number} onChange={handleChange} maxLength={100} className={inputClass("national_id_number")} placeholder="12345678" autoComplete="off" />
                      </label>
                      {errorText("national_id_number")}
                    </div>
                  </div>
                </fieldset>

                <fieldset className="border-t border-slate-200 pt-5">
                  <legend className="text-[11px] font-bold uppercase tracking-wide text-[#0B2239]">Guardian contact</legend>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Guardian name
                        <input name="guardian_name" value={form.guardian_name} onChange={handleChange} maxLength={255} className={inputClass("guardian_name")} placeholder="Parent or guardian" required autoComplete="off" />
                      </label>
                      {errorText("guardian_name")}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Phone
                        <span className="relative block">
                          <span className="pointer-events-none absolute left-3 top-[13px] text-sm font-medium text-slate-500">+254</span>
                          <input type="tel" name="guardian_phone" inputMode="numeric" value={form.guardian_phone} onChange={handlePhoneChange} maxLength={9} className={`${inputClass("guardian_phone")} pl-14`} placeholder="712345678" required autoComplete="off" />
                        </span>
                      </label>
                      {errorText("guardian_phone")}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Email (optional)
                        <input type="email" name="guardian_email" value={form.guardian_email} onChange={handleChange} maxLength={255} className={inputClass("guardian_email")} placeholder="name@example.com" autoComplete="off" />
                      </label>
                      {errorText("guardian_email")}
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Relationship (optional)
                        <input name="relationship_to_student" value={form.relationship_to_student} onChange={handleChange} maxLength={50} className={inputClass("relationship_to_student")} placeholder="Mother, father, aunt..." autoComplete="off" />
                      </label>
                      {errorText("relationship_to_student")}
                    </div>
                  </div>
                </fieldset>

                <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
                  <button type="submit" className="inline-flex items-center gap-2 bg-[#0B2239] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#12293F]">
                    Review application <ArrowRight size={15} aria-hidden="true" />
                  </button>
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <ShieldCheck size={13} aria-hidden="true" /> Nothing is shared with the student&apos;s school by this form.
                  </p>
                </div>
              </form>
            )}

            {stage === "review" && (
              <div className="px-5 py-6">
                <dl>
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
                <p className="mt-4 text-xs leading-relaxed text-[#5C6B78]">
                  Submitting sends these details to the bursary office. If the office finds a possible existing
                  beneficiary, a staff member reviews the case before any student record is created.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <button type="button" onClick={() => setStage("form")} className="inline-flex items-center gap-2 border border-[#C8D4DA] bg-white px-4 py-2.5 text-sm font-semibold text-[#0B2239] hover:border-[#0B2239]/40" disabled={submitting}>
                    <ArrowLeft size={15} aria-hidden="true" /> Edit details
                  </button>
                  <button type="button" onClick={submit} disabled={submitting} className="inline-flex items-center gap-2 bg-[#0E6E6B] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0B5F5C] disabled:cursor-not-allowed disabled:opacity-60">
                    {submitting ? "Submitting..." : "Confirm and submit"}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        <p className="mt-6 text-xs leading-relaxed text-[#7A8891]">
          This form collects only what the bursary office needs to identify the student and reach the guardian.
          Approval of an award is decided by the office, not by this form.
        </p>
      </main>
    </div>
  );
}



