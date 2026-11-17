import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, RefreshCw } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const STATUS_FILTERS = [
  { value: "", label: "All applications" },
  { value: "screened", label: "Screened - awaiting triage or verification" },
  { value: "needs_investigation", label: "Awaiting investigation" },
  { value: "investigated", label: "Awaiting administrator decision" },
  { value: "resolved", label: "Cleared - ready to verify" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

const STATUS_LABELS = {
  submitted: "Received - not screened",
  screened: "Screened",
  needs_investigation: "Awaiting investigation",
  investigated: "Awaiting decision",
  resolved: "Duplicate resolved",
  verified: "Verified",
  award_recommended: "Award recommended",
  approved: "Approved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

const OPEN_CASE_STATUSES = new Set(["pending", "needs_verification"]);

// The statuses the closure endpoints accept. `verified` and later are a deliberate exclusion: the
// student record (and any award attached to it) already exists, so closing would orphan it.
const CLOSABLE_STATUSES = new Set(["submitted", "screened", "needs_investigation", "investigated", "resolved"]);

const EMPTY_ELIGIBILITY = {
  fee_balance: "",
  household_income: "",
  vulnerability_status: "low",
  siblings_in_school: "",
  prior_bursary_history: "none",
};

const fieldClass =
  "mt-1 h-10 w-full border border-slate-300 bg-white px-2 text-sm text-slate-800 outline-none focus:border-sky-400";
const labelClass = "block text-[11px] font-semibold text-slate-700";
const primaryButton = "rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:border-slate-500";
const selectedButton = "rounded border border-slate-800 bg-slate-800 px-3 py-2 text-xs font-semibold text-white";

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

function shortId(value) {
  return value ? `${String(value).slice(0, 8)}…` : "—";
}

function mask(value) {
  if (!value) return "—";
  const text = String(value);
  return text.length <= 4 ? "****" : `****${text.slice(-4)}`;
}

function statusTone(status) {
  if (["verified", "approved"].includes(status)) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (["rejected", "withdrawn"].includes(status)) return "border-slate-200 bg-slate-100 text-slate-700";
  if (["needs_investigation", "investigated"].includes(status)) return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-sky-200 bg-sky-50 text-sky-800";
}

export default function Applications() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [applications, setApplications] = useState([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState(null);

  const [triageReason, setTriageReason] = useState("");
  const [investigation, setInvestigation] = useState({ findings: "", recommendation: "needs_further_checks", notes: "" });
  const [resolution, setResolution] = useState({ outcome: "not_duplicate", canonical_student_id: "", reason: "" });
  const [eligibility, setEligibility] = useState(EMPTY_ELIGIBILITY);
  const [overrideEnabled, setOverrideEnabled] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [closure, setClosure] = useState({ action: "", reason: "" });

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const response = await api.get("/applications", { params: statusFilter ? { status: statusFilter } : {} });
      setApplications(response.data.applications || []);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load applications.");
    } finally {
      setListLoading(false);
    }
  }, [statusFilter]);

  const loadDetail = useCallback(async (id) => {
    setDetailLoading(true);
    try {
      const response = await api.get(`/applications/${id}`);
      setDetail(response.data);
    } catch (err) {
      setDetail(null);
      setError(err.response?.data?.message || "Unable to load that application.");
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  useEffect(() => {
    if (!selectedId) return;
    setDetail(null);
    setRevealed(null);
    setTriageReason("");
    setInvestigation({ findings: "", recommendation: "needs_further_checks", notes: "" });
    setResolution({ outcome: "not_duplicate", canonical_student_id: "", reason: "" });
    setEligibility(EMPTY_ELIGIBILITY);
    setOverrideEnabled(false);
    setOverrideReason("");
    setClosure({ action: "", reason: "" });
    setError("");
    setNotice("");
    loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  async function run(action, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadDetail(selectedId);
      await loadList();
      return true;
    } catch (err) {
      const body = err.response?.data;
      setError(body?.message || "The action could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function submitTriage(event) {
    event.preventDefault();
    await run(
      () => api.post(`/applications/${selectedId}/triage`, { reason: triageReason }),
      "Sent for duplicate investigation.",
    );
  }

  async function submitInvestigation(event) {
    event.preventDefault();
    await run(
      () => api.post(`/applications/${selectedId}/investigation`, investigation),
      "Investigation findings recorded. The administrator decides the case.",
    );
  }

  async function submitResolution(event) {
    event.preventDefault();
    const payload = {
      outcome: resolution.outcome,
      reason: resolution.reason,
      ...(resolution.outcome === "duplicate_of_existing" ? { canonical_student_id: resolution.canonical_student_id } : {}),
    };
    await run(
      () => api.post(`/applications/${selectedId}/resolve`, payload),
      "Duplicate case resolved.",
    );
  }

  async function submitVerification(event) {
    event.preventDefault();
    const payload = {
      eligibility: {
        fee_balance: Number(eligibility.fee_balance),
        household_income: Number(eligibility.household_income),
        vulnerability_status: eligibility.vulnerability_status,
        siblings_in_school: Number(eligibility.siblings_in_school),
        prior_bursary_history: eligibility.prior_bursary_history,
      },
      ...(overrideEnabled && overrideReason.trim().length >= 10 ? { override_reason: overrideReason.trim() } : {}),
    };
    await run(
      () => api.post(`/applications/${selectedId}/verify`, payload),
      "Application verified and the student record created.",
    );
  }

  async function revealIdentifiers() {
    setBusy(true);
    setError("");
    try {
      const response = await api.get(`/applications/${selectedId}/identifiers`);
      setRevealed(response.data.application);
    } catch (err) {
      setError(err.response?.data?.message || "Identifiers could not be revealed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitClosure(event) {
    event.preventDefault();
    if (!closure.action) return;
    const succeeded = await run(
      () => api.post(`/applications/${selectedId}/${closure.action}`, { reason: closure.reason.trim() }),
      closure.action === "reject"
        ? "Application rejected. The reason is on the application and in the audit log."
        : "Application withdrawn. The reason is on the application and in the audit log.",
    );
    if (succeeded) setClosure({ action: "", reason: "" });
  }

  const application = detail?.application || null;
  const cases = detail?.duplicate_cases || [];
  const openCases = cases.filter((entry) => OPEN_CASE_STATUSES.has(entry.status));
  const canVerify = application
    && ["screened", "resolved"].includes(application.status)
    && !application.duplicate_of_student_id;

  const displayValue = (field) => {
    if (revealed) return revealed[field] || "Not provided";
    return application?.[field] ? mask(application[field]) : "—";
  };

  // Both roles make the same audited reveal request; the detail payload no longer carries raw values
  // for anyone, so the button is not role-gated.
  const canClose = application && CLOSABLE_STATUSES.has(application.status);

  return (
    <main className="space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Guardian applications</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Applications submitted by guardians. Administrators triage and resolve duplicate cases;
            field officers investigate and verify. A student record exists only after verification.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <label className={labelClass}>Status
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={`${fieldClass} w-64`}>
              {STATUS_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={loadList} disabled={listLoading} className={secondaryButton}>
            <span className="inline-flex items-center gap-1"><RefreshCw size={13} aria-hidden="true" /> Refresh</span>
          </button>
        </div>
      </header>

      {notice && <div className="border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{notice}</div>}
      {error && <div className="border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)]">
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Queue</h2>
            <p className="mt-1 text-xs text-slate-500">{applications.length} shown, newest first, up to 200.</p>
          </div>
          {listLoading ? (
            <p className="px-4 py-6 text-sm text-slate-500">Loading applications…</p>
          ) : applications.length === 0 ? (
            <div className="px-4 py-6 text-sm text-slate-600">
              <p>No applications match this filter.</p>
              <p className="mt-2 text-xs text-slate-500">
                Guardians submit through the public form at <Link to="/apply" className="text-sky-700 underline">/apply</Link>.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-200">
              {applications.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className={`w-full px-4 py-3 text-left transition ${selectedId === entry.id ? "bg-slate-100" : "hover:bg-slate-50"}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <span className="font-medium text-slate-900">{entry.full_name}</span>
                      <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-semibold ${statusTone(entry.status)}`}>
                        {STATUS_LABELS[entry.status] || entry.status}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-slate-600">
                      {entry.school_code} · submitted {formatDate(entry.created_at)}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-3 text-[11px] text-slate-500">
                      <span>Ref {shortId(entry.id)}</span>
                      {entry.open_cases > 0 && <span className="font-semibold text-amber-700">{entry.open_cases} open duplicate case(s)</span>}
                      {entry.screening_failure_code && <span className="font-semibold text-amber-700">Not screened</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="border border-slate-200 bg-white">
          {!selectedId && (
            <div className="px-5 py-10 text-sm text-slate-600">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Application detail</h2>
              <p className="mt-2">Select an application from the queue to review it.</p>
            </div>
          )}

          {selectedId && detailLoading && <p className="px-5 py-6 text-sm text-slate-500">Loading application…</p>}

          {selectedId && !detailLoading && application && (
            <div>
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{application.full_name}</h2>
                  <p className="mt-1 text-xs text-slate-600">
                    {application.school_code} · born {application.date_of_birth || "not recorded"} · ref {application.id}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded border px-2 py-1 text-xs font-semibold ${statusTone(application.status)}`}>
                    {STATUS_LABELS[application.status] || application.status}
                  </span>
                  <button type="button" onClick={revealIdentifiers} disabled={busy} className={secondaryButton}>
                    <span className="inline-flex items-center gap-1"><Eye size={13} aria-hidden="true" /> {revealed ? "Revealed" : "Reveal identifiers"}</span>
                  </button>
                </div>
              </div>

              {application.screening_failure_code && (
                <p className="mx-5 mt-4 border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Screening was not completed ({application.screening_failure_code}). This application is not
                  evidence of a clean record; review the submitted identity details manually.
                </p>
              )}
              {application.duplicate_of_student_id && (
                <p className="mx-5 mt-4 border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                  Resolved as a duplicate of an existing student. This application cannot create a second
                  student record or receive an award.
                </p>
              )}

              <dl className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2">
                <div className="flex justify-between gap-3"><dt className="text-slate-500">UPI</dt><dd className="font-medium">{displayValue("upi")}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Birth certificate</dt><dd className="font-medium">{displayValue("birth_certificate_number")}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">National ID</dt><dd className="font-medium">{displayValue("national_id_number")}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Guardian phone</dt><dd className="font-medium">{displayValue("guardian_phone")}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Guardian name</dt><dd className="font-medium">{application.guardian_name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Submitted</dt><dd className="font-medium">{formatDate(application.created_at)}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Screening score</dt><dd className="font-medium">{application.screening_score ?? "Not recorded"}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-slate-500">Screening priority</dt><dd className="font-medium">{application.screening_priority || "Not recorded"}</dd></div>
              </dl>
              {revealed && (
                <p className="mx-5 mb-4 text-[11px] text-slate-500">
                  Identifiers revealed for this review. The reveal is recorded in the audit log.
                </p>
              )}

              <div className="border-t border-slate-200 px-5 py-4">
                <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Duplicate evidence</h3>
                {cases.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No duplicate case was opened for this application.</p>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                      <thead className="border-b border-slate-200 text-[11px] uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="py-2 pr-4">Candidate student</th>
                          <th className="py-2 pr-4">Matched identifiers</th>
                          <th className="py-2 pr-4">Score</th>
                          <th className="py-2">Case</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {cases.map((entry) => (
                          <tr key={entry.id}>
                            <td className="py-2 pr-4">
                              <span className="font-medium text-slate-900">{entry.matched_full_name}</span>
                              <span className="block text-xs text-slate-500">{entry.matched_school_code || "School not recorded"}</span>
                            </td>
                            <td className="py-2 pr-4 text-xs text-slate-600">
                              UPI {entry.matched_upi || "unavailable"} · BC {entry.matched_birth_certificate_number || "unavailable"}
                            </td>
                            <td className="py-2 pr-4 text-xs text-slate-600">
                              {entry.probability ?? "—"} <span className="text-slate-400">/ {entry.review_threshold ?? "—"}</span>
                            </td>
                            <td className="py-2 text-xs">
                              <span className="font-medium">{entry.status.replaceAll("_", " ")}</span>
                              <span className="block text-slate-500">{formatDate(entry.created_at)}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <p className="mt-2 text-[11px] text-slate-500">
                  A score is evidence for a reviewer, not a decision. Only exact identifier agreement or a
                  recorded human decision makes a duplicate.
                </p>
              </div>

              {["rejected", "withdrawn"].includes(application.status) && (
                <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 text-sm text-slate-700">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                    {application.status === "rejected" ? "Rejected application" : "Withdrawn application"}
                  </h3>
                  <p className="mt-2">{application.closure_reason || "No reason recorded."}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Closed {formatDate(application.closed_at)} by {shortId(application.closed_by)}. The
                    application is kept as evidence, and it cannot be verified or awarded.
                  </p>
                </div>
              )}

              {canClose && (
                <form onSubmit={submitClosure} className="border-t border-slate-200 px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Close this application</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Rejecting or withdrawing ends the workflow without creating a student record. A reason of
                    at least ten characters is required, and the decision is written to the audit log.
                  </p>
                  {openCases.length > 0 && (
                    <p className="mt-2 text-xs text-amber-800">
                      An open duplicate case must be resolved before this application can be closed.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => setClosure((current) => ({ ...current, action: "reject" }))}
                        className={closure.action === "reject" ? selectedButton : secondaryButton}
                      >
                        Reject
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setClosure((current) => ({ ...current, action: "withdraw" }))}
                      className={closure.action === "withdraw" ? selectedButton : secondaryButton}
                    >
                      Withdraw
                    </button>
                  </div>
                  {!isAdmin && (
                    <p className="mt-2 text-[11px] text-slate-500">
                      Only an administrator may reject an application. A field officer records a withdrawal
                      when the guardian no longer wants the bursary.
                    </p>
                  )}
                  {closure.action && (
                    <>
                      <label className={`${labelClass} mt-3`}>Reason
                        <textarea
                          required
                          minLength={10}
                          maxLength={2000}
                          rows={2}
                          value={closure.reason}
                          onChange={(event) => setClosure((current) => ({ ...current, reason: event.target.value }))}
                          className={fieldClass}
                          placeholder="Why is this application being closed?"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={busy || closure.reason.trim().length < 10}
                        className={`${primaryButton} mt-3`}
                      >
                        {busy ? "Saving…" : closure.action === "reject" ? "Reject application" : "Withdraw application"}
                      </button>
                    </>
                  )}
                </form>
              )}

              {isAdmin && application.status === "screened" && openCases.length > 0 && (
                <form onSubmit={submitTriage} className="border-t border-slate-200 px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Administrator triage</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Send this application to a Field Officer for investigation. A reason is required.
                  </p>
                  <label className={`${labelClass} mt-3`}>Reason
                    <textarea required minLength={5} maxLength={2000} rows={2} value={triageReason} onChange={(event) => setTriageReason(event.target.value)} className={fieldClass} placeholder="What should the officer check?" />
                  </label>
                  <button type="submit" disabled={busy || triageReason.trim().length < 5} className={`${primaryButton} mt-3`}>
                    {busy ? "Saving…" : "Send for investigation"}
                  </button>
                </form>
              )}

              {!isAdmin && application.status === "needs_investigation" && (
                <form onSubmit={submitInvestigation} className="border-t border-slate-200 px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Investigation findings</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Record what you checked. This is evidence for the administrator, not a duplicate decision.
                  </p>
                  <label className={`${labelClass} mt-3`}>Findings
                    <textarea required minLength={5} maxLength={2000} rows={3} value={investigation.findings} onChange={(event) => setInvestigation((current) => ({ ...current, findings: event.target.value }))} className={fieldClass} placeholder="Which documents or visits did you check?" />
                  </label>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Recommendation
                      <select value={investigation.recommendation} onChange={(event) => setInvestigation((current) => ({ ...current, recommendation: event.target.value }))} className={fieldClass}>
                        <option value="likely_duplicate">Likely duplicate</option>
                        <option value="likely_not_duplicate">Likely not a duplicate</option>
                        <option value="needs_further_checks">Needs further checks</option>
                      </select>
                    </label>
                    <label className={labelClass}>Notes (optional)
                      <input maxLength={2000} value={investigation.notes} onChange={(event) => setInvestigation((current) => ({ ...current, notes: event.target.value }))} className={fieldClass} />
                    </label>
                  </div>
                  <button type="submit" disabled={busy || investigation.findings.trim().length < 5} className={`${primaryButton} mt-3`}>
                    {busy ? "Saving…" : "Submit findings"}
                  </button>
                </form>
              )}

              {isAdmin && ["screened", "needs_investigation", "investigated"].includes(application.status) && openCases.length > 0 && (
                <form onSubmit={submitResolution} className="border-t border-slate-200 px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Administrator decision</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    The administrator, not the officer and not the model, decides this case. A confirmed
                    duplicate never creates a student record.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Outcome
                      <select value={resolution.outcome} onChange={(event) => setResolution((current) => ({ ...current, outcome: event.target.value }))} className={fieldClass}>
                        <option value="not_duplicate">Not a duplicate - allow verification</option>
                        <option value="duplicate_of_existing">Confirmed duplicate of an existing student</option>
                      </select>
                    </label>
                    {resolution.outcome === "duplicate_of_existing" && (
                      <label className={labelClass}>Canonical student
                        <select required value={resolution.canonical_student_id} onChange={(event) => setResolution((current) => ({ ...current, canonical_student_id: event.target.value }))} className={fieldClass}>
                          <option value="" disabled>Select the record that is the real student…</option>
                          {openCases.map((entry) => (
                            <option key={entry.matched_student_id} value={entry.matched_student_id}>
                              {entry.matched_full_name} · UPI {entry.matched_upi || "unavailable"}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </div>
                  <label className={`${labelClass} mt-3`}>Reason
                    <textarea required minLength={5} maxLength={2000} rows={2} value={resolution.reason} onChange={(event) => setResolution((current) => ({ ...current, reason: event.target.value }))} className={fieldClass} placeholder="Which evidence decided this case?" />
                  </label>
                  <button
                    type="submit"
                    disabled={busy || resolution.reason.trim().length < 5 || (resolution.outcome === "duplicate_of_existing" && !resolution.canonical_student_id)}
                    className={`${primaryButton} mt-3`}
                  >
                    {busy ? "Saving…" : "Save decision"}
                  </button>
                </form>
              )}

              {canVerify && (
                <form onSubmit={submitVerification} className="border-t border-slate-200 px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-wide text-slate-700">Verification and eligibility</h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Verification creates the student record and saves one eligibility assessment using the
                    rules in <code className="text-[11px]">services/eligibility.js</code>. Record the figures you
                    confirmed, not the guardian&apos;s declaration. The assessment guides the award decision; it
                    never approves an award.
                  </p>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>Fee balance (KSh)
                      <input type="number" min="0" step="0.01" required value={eligibility.fee_balance} onChange={(event) => setEligibility((current) => ({ ...current, fee_balance: event.target.value }))} className={fieldClass} />
                    </label>
                    <label className={labelClass}>Household income (KSh per month)
                      <input type="number" min="0" step="0.01" required value={eligibility.household_income} onChange={(event) => setEligibility((current) => ({ ...current, household_income: event.target.value }))} className={fieldClass} />
                    </label>
                    <label className={labelClass}>Vulnerability status
                      <select value={eligibility.vulnerability_status} onChange={(event) => setEligibility((current) => ({ ...current, vulnerability_status: event.target.value }))} className={fieldClass}>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                    <label className={labelClass}>Siblings in school
                      <input type="number" min="0" step="1" required value={eligibility.siblings_in_school} onChange={(event) => setEligibility((current) => ({ ...current, siblings_in_school: event.target.value }))} className={fieldClass} />
                    </label>
                    <label className={labelClass}>Prior bursary history
                      <select value={eligibility.prior_bursary_history} onChange={(event) => setEligibility((current) => ({ ...current, prior_bursary_history: event.target.value }))} className={fieldClass}>
                        <option value="none">None</option>
                        <option value="low">Low</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                  </div>

                  {isAdmin && (
                    <div className="mt-4 border border-amber-200 bg-amber-50 p-3">
                      <label className="flex items-start gap-2 text-xs text-amber-900">
                        <input type="checkbox" checked={overrideEnabled} onChange={(event) => setOverrideEnabled(event.target.checked)} className="mt-0.5" />
                        <span>
                          Override the duplicate gate. Only an administrator may do this, only with a written
                          reason of at least ten characters, and the override is audited.
                        </span>
                      </label>
                      {overrideEnabled && (
                        <textarea required minLength={10} maxLength={2000} rows={2} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} className={`${fieldClass} mt-2`} placeholder="Why is this application safe to verify despite the duplicate case?" />
                      )}
                    </div>
                  )}

                  {!isAdmin && openCases.length > 0 && (
                    <p className="mt-3 text-xs text-amber-800">
                      An open duplicate case blocks verification. A field officer cannot override it; the
                      administrator must resolve the case first.
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={busy || eligibility.fee_balance === "" || eligibility.household_income === "" || eligibility.siblings_in_school === "" || (overrideEnabled && overrideReason.trim().length < 10)}
                    className={`${primaryButton} mt-3`}
                  >
                    {busy ? "Saving…" : "Verify and create student"}
                  </button>
                </form>
              )}

              {application.status === "verified" && (
                <div className="border-t border-slate-200 px-5 py-4 text-sm text-slate-700">
                  <p>Verified on {formatDate(application.verified_at)}. The student record holds the eligibility assessment.</p>
                  <Link to="/students" className="mt-1 inline-block text-xs font-semibold text-sky-700 hover:underline">Open student records</Link>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}






