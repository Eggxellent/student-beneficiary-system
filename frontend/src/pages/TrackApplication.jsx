import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, GraduationCap, Search } from "lucide-react";
import api from "../services/api";

// Plain-language status labels for a guardian. The internal status names stay internal: a parent
// needs to know whether the application is waiting, being checked, or decided.
const STATUS_LABELS = {
  submitted: "Received - initial checks not recorded",
  screened: "Received and checked",
  needs_investigation: "Under duplicate review",
  investigated: "Review findings recorded",
  resolved: "Duplicate review decided",
  verified: "Verified - student record created",
  award_recommended: "Award recommended",
  approved: "Award approved",
  rejected: "Closed without an award",
  withdrawn: "Withdrawn",
};

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

const fieldClass =
  "mt-2 h-11 w-full border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-[#0E6E6B] focus:bg-white";

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

export default function TrackApplication() {
  const [form, setForm] = useState({ tracking_code: "", date_of_birth: "" });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setError("");
    setResult(null);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/applications/track", {
        tracking_code: form.tracking_code.trim().toUpperCase(),
        date_of_birth: form.date_of_birth,
      });
      setResult(response.data);
    } catch (err) {
      // One message for every failure: a wrong code and a wrong date of birth look the same, so the
      // endpoint cannot be used to test whether a code exists.
      setError(err.response?.data?.message || "No application matches that tracking code and date of birth.");
    } finally {
      setLoading(false);
    }
  }

  const application = result?.application;
  const timeline = result?.timeline || [];

  return (
    <div className="min-h-screen bg-[#F7F9FA] text-[#12293F]">
      <header className="border-b border-[#E4EAEE] bg-white">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-8">
          <Link to="/" className="flex items-center gap-2 text-sm font-bold tracking-[0.14em] text-[#0B2239]">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-[#0B2239] text-[#C8A45D]">
              <GraduationCap size={17} aria-hidden="true" />
            </span>
            SBMS
          </Link>
          <nav className="flex items-center gap-5 text-xs font-semibold text-[#46545F]" aria-label="Application links">
            <Link to="/apply" className="hover:text-[#0B2239]">Apply</Link>
            <Link to="/apply/track" className="text-[#0B2239]">Track an application</Link>
            <Link to="/verify-certificate" className="hover:text-[#0B2239]">Verify a document</Link>
            <Link to="/login" className="hover:text-[#0B2239]">Staff login</Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-8 sm:py-12">
        <Link to="/apply" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0E6E6B] hover:underline">
          <ArrowLeft size={13} aria-hidden="true" /> Apply for a bursary
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-[#0B2239] sm:text-3xl">Track an application</h1>
        <p className="mt-3 text-sm leading-relaxed text-[#4E5C66]">
          Enter the tracking code given when the application was submitted, together with the student&apos;s date
          of birth. Both are required. This page shows only the progress of that application.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 border border-slate-300 bg-white p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Tracking code
              <input name="tracking_code" value={form.tracking_code} onChange={handleChange} maxLength={32} className={`${fieldClass} font-mono tracking-[0.12em]`} placeholder="XXXXXXXXXX" required autoComplete="off" spellCheck={false} />
            </label>
            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-800">Student date of birth
              <input type="date" name="date_of_birth" value={form.date_of_birth} onChange={handleChange} className={fieldClass} required />
            </label>
          </div>
          <button type="submit" disabled={loading} className="mt-4 inline-flex items-center gap-2 bg-[#0B2239] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#12293F] disabled:cursor-not-allowed disabled:opacity-60">
            <Search size={15} aria-hidden="true" /> {loading ? "Checking..." : "Check status"}
          </button>
        </form>

        {error && <div className="mt-5 border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}

        {application && (
          <section className="mt-6 border border-slate-200 bg-white" aria-live="polite">
            <div className="border-b border-slate-200 px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Current status</p>
              <p className="mt-1 text-lg font-semibold text-[#0B2239]">
                {STATUS_LABELS[application.status] || application.status}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                {application.full_name} · {application.school_code}
              </p>
            </div>
            <dl className="grid gap-3 px-5 py-4 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Submitted</dt><dd className="font-medium">{formatDate(application.submitted_at)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-slate-500">Last updated</dt><dd className="font-medium">{formatDate(application.updated_at)}</dd></div>
            </dl>
            {application.screening_unavailable && (
              <p className="mx-5 mb-4 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                Initial duplicate checks were not completed for this application. Office staff will review it
                manually; this is not a decision.
              </p>
            )}
            {timeline.length > 0 && (
              <div className="border-t border-slate-200 px-5 py-4">
                <h2 className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Progress</h2>
                <ol className="mt-3 space-y-3">
                  {timeline.map((event, index) => (
                    <li key={`${event.action}-${event.at}-${index}`} className="flex gap-3">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0E6E6B]" aria-hidden="true" />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{EVENT_LABELS[event.action] || "Application updated"}</p>
                        <p className="text-xs text-slate-500">{formatDate(event.at)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>
        )}

        <p className="mt-6 text-xs leading-relaxed text-[#7A8891]">
          If the code is lost, contact the bursary office with the student&apos;s UPI or birth certificate number.
          The tracking page never shows another applicant&apos;s information, any duplicate evidence, or staff notes.
        </p>
      </main>
    </div>
  );
}
