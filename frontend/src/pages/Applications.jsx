import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../services/api";

// Administrator view of the guardian submission queue. The application is the record the guardian
// submitted; the student record it produced is what duplicate screening, eligibility, awards and
// the Field Officer screens use. Both are shown together so a submission can never look "lost"
// simply because its student is waiting on a review.

const STATUS_STYLES = {
  submitted: "border-slate-200 bg-slate-50 text-slate-700",
  under_review: "border-sky-200 bg-sky-50 text-sky-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

const DUPLICATE_STYLES = {
  pending: "border-orange-200 bg-orange-50 text-orange-800",
  needs_verification: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed_duplicate: "border-red-200 bg-red-50 text-red-700",
  not_duplicate: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cleared: "border-emerald-200 bg-emerald-50 text-emerald-800",
  not_screened: "border-slate-200 bg-slate-50 text-slate-600",
};

const DUPLICATE_LABELS = {
  pending: "Under Review",
  needs_verification: "Under Review",
  confirmed_duplicate: "Confirmed Duplicate",
  not_duplicate: "Cleared",
  cleared: "Cleared",
  not_screened: "Not Screened",
};
const ELIGIBILITY_FIELDS = [
  ["fee_balance", "Outstanding fee balance (KES)", "number"],
  ["household_income", "Monthly household income (KES)", "number"],
  ["vulnerability_status", "Vulnerability", "vulnerability"],
  ["siblings_in_school", "Siblings in school", "integer"],
  ["prior_bursary_history", "Previous bursary assistance", "history"],
];

function label(value) {
  if (!value) return "—";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function detailRows(detail) {
  if (!detail) return [];
  return [
    ["Date of birth", detail.student?.dateOfBirth],
    ["Gender", detail.student?.gender],
    ["Birth certificate / identifier", detail.student?.identification],
    ["Relationship to student", detail.student?.relationship],
    ["School", detail.school?.name],
    ["Level / class", [detail.school?.level, detail.school?.currentClass].filter(Boolean).join(" · ")],
    ["Admission number", detail.school?.admissionNumber],
    ["County", detail.school?.location],
    ["Guardian on application", detail.household?.guardianName],
    ["Guardian phone", detail.household?.phone],
    ["Household", detail.household?.size],
    ["Income source", detail.household?.incomeSource],
    ["Monthly income", detail.household?.monthlyIncome],
  ].filter(([, value]) => value && value !== "—");
}

export default function Applications() {
  const [applications, setApplications] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [correctionValues, setCorrectionValues] = useState({});
  const [correctionBaseline, setCorrectionBaseline] = useState({});
  const [correctionReason, setCorrectionReason] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const detailsRef = useRef(null);

  async function loadApplications() {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get("/guardian/staff/applications");
      const rows = Array.isArray(data?.applications) ? data.applications : [];
      setApplications(rows);
      setSelectedId((current) =>
        current && rows.some((row) => row.id === current) ? current : null,
      );
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Unable to load guardian applications.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApplications();
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return applications.filter((application) => {
      if (statusFilter !== "all" && application.status_code !== statusFilter) return false;
      if (!needle) return true;
      return [
        application.reference,
        application.student,
        application.school,
        application.guardianAccount,
        application.guardianEmail,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [applications, query, statusFilter]);

  const selected = applications.find((application) => application.id === selectedId) || null;

  useEffect(() => {
    if (selectedId) detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);

  function toggleApplicationDetails(application) {
    if (application.id === selectedId) {
      setSelectedId(null);
      return;
    }
    setSelectedId(application.id);
    setNote(application.detail?.decisionNote || "");
    setNotice("");
    const values = Object.fromEntries(ELIGIBILITY_FIELDS.map(([key]) => [
      key,
      application.eligibility_inputs?.[key] == null ? "" : String(application.eligibility_inputs[key]),
    ]));
    setCorrectionValues(values);
    setCorrectionBaseline(values);
    setCorrectionReason("");
  }

  async function recordDecision(status) {
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api.patch(`/guardian/staff/applications/${selected.id}/status`, {
        status,
        note: note.trim() || undefined,
      });
      setNotice(`Application ${selected.reference} marked ${label(status).toLowerCase()}.`);
      setNote("");
      await loadApplications();
    } catch (requestError) {
      setError(requestError.response?.data?.error || "Unable to record this decision.");
    } finally {
      setSaving(false);
    }
  }

  async function correctEligibilityInputs(event) {
    event.preventDefault();
    if (!selected?.student_id) return;
    const changes = {};
    for (const [key, , type] of ELIGIBILITY_FIELDS) {
      const value = correctionValues[key] ?? "";
      if (value === correctionBaseline[key] || value.trim() === "") continue;
      changes[key] = type === "number" || type === "integer" ? Number(value) : value;
    }
    if (!Object.keys(changes).length) {
      setError("Change at least one value before saving a correction.");
      return;
    }
    setCorrecting(true);
    setError("");
    setNotice("");
    try {
      const { data } = await api.patch(`/eligibility/${selected.student_id}/correction`, {
        ...changes,
        reason: correctionReason.trim(),
      });
      setNotice(data.message);
      setCorrectionReason("");
      await loadApplications();
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save the eligibility correction.");
    } finally {
      setCorrecting(false);
    }
  }

  const duplicateDecisionLocked = selected && (!selected.student_id || ["under_review", "confirmed_duplicate", "not_screened"].includes(
    selected.duplicate?.status,
  ));



  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Guardian applications</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Review guardian submissions and their linked student records.
          </p>
        </div>
        <button
          type="button"
          onClick={loadApplications}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {notice && <p className="mb-4 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</p>}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reference, student, school or guardian"
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
        >
          <option value="all">All statuses</option>
          <option value="under_review">Under review</option>
          <option value="submitted">Submitted</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <section aria-label="Application results" className="space-y-3">
        {!loading && filtered.length > 0 && (
          <p className="text-sm text-slate-500">
            Showing {filtered.length} {filtered.length === 1 ? "application" : "applications"}
          </p>
        )}
        {filtered.map((application) => {
          const isSelected = application.id === selectedId;
          return (
            <article
              key={application.id}
              role="button"
              tabIndex={0}
              aria-label={`${isSelected ? "Close" : "Open"} details for ${application.reference}`}
              aria-expanded={isSelected}
              onClick={() => toggleApplicationDetails(application)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleApplicationDetails(application);
                }
              }}
              className={`cursor-pointer rounded-xl border bg-white p-4 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-200 sm:p-5 ${
                isSelected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-base font-semibold text-slate-900">
                      {application.student || "Student name unavailable"}
                    </h2>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status_code] || STATUS_STYLES.submitted}`}>
                      {application.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{application.school || "School unavailable"}</p>
                </div>
              </div>

              <dl className="mt-4 grid gap-x-6 gap-y-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Guardian</dt>
                  <dd className="mt-0.5 truncate font-medium text-slate-800" title={application.guardianAccount}>
                    {application.guardianAccount || "Not provided"}
                  </dd>
                  {application.guardianEmail && (
                    <dd className="truncate text-xs text-slate-500" title={application.guardianEmail}>
                      {application.guardianEmail}
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Submitted</dt>
                  <dd className="mt-0.5 text-slate-800">{shortDate(application.submitted_at)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Application</dt>
                  <dd className="mt-0.5 break-all font-medium text-slate-800">{application.reference}</dd>
                </div>
              </dl>

              <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                {application.registeredStudent ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                    <span className="font-semibold">Student record</span>
                    <span className="truncate">Admission no. {application.registeredStudent.admission_number || "Not captured"}</span>
                  </span>
                ) : (
                  <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                    Student record not linked
                  </span>
                )}
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${DUPLICATE_STYLES[application.duplicate?.status] || DUPLICATE_STYLES.not_screened}`}>
                  Duplicate Screening: {DUPLICATE_LABELS[application.duplicate?.status] || "Not Screened"}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  {application.assessment
                    ? `${label(application.assessment.status)} assessment${
                        application.assessment.score === null ? "" : ` · ${application.assessment.score}/100`
                      }`
                    : "No assessment yet"}
                </span>
              {application.assessment?.status === "incomplete" && application.assessment.missing_inputs?.length > 0 && (
                <span className="w-full text-xs text-amber-800">Missing: {application.assessment.missing_inputs.map(label).join(", ")}</span>
              )}
              </div>
            </article>
          );
        })}
        {!loading && filtered.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-slate-500">
            No guardian applications match this filter.
          </p>
        )}
        {loading && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-500">
            Loading applications...
          </p>
        )}
      </section>

      {selected && (
        <section ref={detailsRef} className="mt-6 scroll-mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{selected.reference}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {selected.detail?.student?.name} · {selected.detail?.school?.name}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected.registeredStudent && (
                <Link
                  to={`/duplicate-review?student=${selected.registeredStudent.id}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                >
                  Duplicate review <ExternalLink size={13} aria-hidden="true" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>

          {!selected.registeredStudent && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              No student record is linked to this application yet. Contact system support to restore it.
            </p>
          )}

          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {detailRows(selected.detail).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                <dt className="text-slate-500">{name}</dt>
                <dd className="text-right font-medium text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>

          {selected.registeredStudent && !duplicateDecisionLocked && selected.status_code !== "rejected" && (
            <details className="mt-5 rounded-lg border border-slate-200 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-800">Correct financial-need inputs</summary>
              <p className="mt-2 text-xs text-slate-600">Admin correction only. The submitted values and earlier assessments remain in the audit history. Give a reason; blank values remain missing.</p>
              <form className="mt-4 space-y-3" onSubmit={correctEligibilityInputs}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {ELIGIBILITY_FIELDS.map(([key, title, type]) => (
                    <label key={key} className="block text-xs font-medium text-slate-700">
                      {title}
                      {type === "vulnerability" ? (
                        <select value={correctionValues[key] || ""} onChange={(event) => setCorrectionValues((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <option value="">Not supplied</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
                        </select>
                      ) : type === "history" ? (
                        <select value={correctionValues[key] || ""} onChange={(event) => setCorrectionValues((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm">
                          <option value="">Not supplied</option><option value="none">None</option><option value="low">Limited assistance</option><option value="high">Substantial assistance</option>
                        </select>
                      ) : (
                        <input type="number" min="0" max={type === "integer" ? 20 : 1000000000} step={type === "integer" ? 1 : "0.01"} value={correctionValues[key] || ""} onChange={(event) => setCorrectionValues((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                      )}
                    </label>
                  ))}
                </div>
                <label className="block text-xs font-medium text-slate-700">Correction reason (required)
                  <textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} minLength={5} maxLength={2000} required rows={2} className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm" />
                </label>
                <button type="submit" disabled={correcting || correctionReason.trim().length < 5} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{correcting ? "Saving…" : "Save correction"}</button>
              </form>
            </details>
          )}

          {duplicateDecisionLocked ? (
            <p className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              This application is read-only until duplicate screening is explicitly complete and cleared. Resolve any pending case in Duplicate Review first.
            </p>
          ) : <div className="mt-5 border-t border-slate-100 pt-4">
            <label htmlFor="decision-note" className="text-sm font-medium text-slate-800">
              Decision note <span className="font-normal text-slate-500">(required when rejecting)</span>
            </label>
            <textarea
              id="decision-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="What was verified for this application?"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => recordDecision("approved")}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                Approve Guardian application
              </button>
              <button
                type="button"
                disabled={saving || note.trim().length < 5}
                onClick={() => recordDecision("rejected")}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-60"
              >
                Reject application
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => recordDecision("under_review")}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Keep under review
              </button>
            </div>
          </div>}
        </section>
      )}
    </main>
  );
}


