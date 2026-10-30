import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const initialSummary = { high_priority_pending: 0, standard_review_pending: 0, awaiting_verification: 0 };
const initialTotals = { flagged: 0, confirmed_duplicate: 0, not_duplicate: 0, unresolved: 0 };
const evidenceLabels = {
  name: "Name similarity",
  date_of_birth: "Date of birth",
  school: "School identifier",
  guardian: "Guardian",
  upi: "UPI",
  birth_certificate: "Birth certificate",
  national_id: "National ID",
};

function prettyStatus(status) {
  return ({ pending: "Pending review", needs_verification: "Needs further verification", confirmed_duplicate: "Confirmed duplicate", not_duplicate: "Not a duplicate" })[status] || status;
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : "—";
}

export default function DuplicateReview() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [cases, setCases] = useState([]);
  const [summary, setSummary] = useState(initialSummary);
  const [caseTotals, setCaseTotals] = useState(initialTotals);
  const [pagination, setPagination] = useState({ page: 1, page_size: 20, total: 0, pages: 0 });
  const [policy, setPolicy] = useState(null);
  const [schools, setSchools] = useState([]);
  const [filters, setFilters] = useState({ search: "", status: "open", priority: "all", school: "", from: "", to: "" });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [decision, setDecision] = useState("not_duplicate");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const fetchCases = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/duplicate-flags", { params: { ...filters, page, page_size: 20 } });
      setCases(response.data.cases);
      setSummary(response.data.summary);
      setCaseTotals(response.data.case_totals);
      setPagination(response.data.pagination);
      setPolicy(response.data.policy);
      setSchools(response.data.schools || []);
      if (!response.data.cases.some((item) => item.id === selectedId)) setSelectedId(null);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load review cases.");
    } finally {
      setLoading(false);
    }
  }, [filters, page, selectedId]);

  useEffect(() => { fetchCases(); }, [fetchCases]);

  function updateFilter(event) {
    setFilters((current) => ({ ...current, [event.target.name]: event.target.value }));
    setPage(1);
  }

  async function submitDecision(event) {
    event.preventDefault();
    if (!selectedId || reason.trim().length < 5) return;
    setSaving(true);
    setError("");
    try {
      await api.patch(`/duplicate-flags/${selectedId}`, { decision, reason: reason.trim(), notes: notes.trim() });
      setNotice("Decision saved.");
      setReason("");
      setNotes("");
      setSelectedId(null);
      await fetchCases();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save this review decision.");
    } finally {
      setSaving(false);
    }
  }

  const selected = cases.find((item) => item.id === selectedId);

  return (
    <div className="mx-auto max-w-7xl p-5 sm:p-8">
      <h1 className="text-2xl font-bold text-slate-900">Duplicate Review</h1>
      <p className="mt-1 text-sm text-slate-600">Potential matches for human review. Flags and model scores do not prove fraud.</p>

      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Open review counts">
        <SummaryCard label="High priority" value={summary.high_priority_pending} />
        <SummaryCard label="Standard review" value={summary.standard_review_pending} />
        <SummaryCard label="Needs verification" value={summary.awaiting_verification} />
      </section>
      <p className="mt-3 text-xs text-slate-500">Cases: {caseTotals.flagged} flagged · {caseTotals.confirmed_duplicate} confirmed · {caseTotals.not_duplicate} not duplicates · {caseTotals.unresolved} unresolved.</p>

      {policy && <p className="mt-3 text-xs text-slate-500">Cutoffs: standard {Number.isFinite(Number(policy.review_threshold)) ? Number(policy.review_threshold).toFixed(2) : "not set"}, high {Number.isFinite(Number(policy.high_priority_threshold)) ? Number(policy.high_priority_threshold).toFixed(2) : "not set"} · aggregation {policy.aggregation_policy || "not reported"}. {policy.thresholds_validated ? "Validated on held-out data." : "Provisional; validation is unavailable."} Exact identifier matches are separate evidence. Candidates withheld by the aggregation policy are recorded in the audit log.</p>}
      {notice && <p className="mt-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">{notice}</p>}
      {error && <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>}

      <section className="mt-5 grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-6" aria-label="Filter review cases">
        <label className="relative text-xs font-medium text-slate-600 sm:col-span-2">Search name or case ID
          <Search size={14} className="absolute left-2 top-8 text-slate-400" aria-hidden="true" />
          <input name="search" value={filters.search} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 pl-7 pr-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-600">Status
          <select name="status" value={filters.status} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm">
            <option value="open">Open</option><option value="pending">Pending</option><option value="needs_verification">Needs verification</option><option value="confirmed_duplicate">Confirmed duplicate</option><option value="not_duplicate">Not a duplicate</option><option value="all">All</option>
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">Priority
          <select name="priority" value={filters.priority} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm"><option value="all">All priorities</option><option value="high">High</option><option value="standard">Standard</option></select>
        </label>
        <label className="text-xs font-medium text-slate-600">School
          <select name="school" value={filters.school} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm"><option value="">All schools</option>{schools.map((school) => <option key={school} value={school}>{school}</option>)}</select>
        </label>
        <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-2">
          <label className="text-xs font-medium text-slate-600">From<input aria-label="From date" type="date" name="from" value={filters.from} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm" /></label>
          <label className="text-xs font-medium text-slate-600">To<input aria-label="To date" type="date" name="to" value={filters.to} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm" /></label>
        </div>
      </section>

      {loading ? <p className="py-10 text-center text-sm text-slate-500">Loading review cases…</p> : cases.length === 0 ? (
        <div className="mt-5 rounded border border-slate-200 bg-white px-5 py-10 text-center">
          <h2 className="font-semibold text-slate-800">No matching cases</h2>
          <p className="mt-1 text-sm text-slate-600">No cases match these filters. This does not rule out duplicates.</p>
        </div>
      ) : (
        <>
          <div className="mt-5 overflow-x-auto rounded border border-slate-200 bg-white">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="px-4 py-3">Case</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Action</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((item) => <tr key={item.id}>
                  <td className="px-4 py-3"><span className="font-medium">{item.students[0].full_name}</span><span className="px-2 text-slate-400">↔</span>{item.students[1].full_name}<div className="text-xs text-slate-500">School identifier: {item.students[0].school_code || "Unavailable"} · {item.students[1].school_code || "Unavailable"}</div></td>
                  <td className="px-4 py-3 capitalize">{item.priority}</td><td className="px-4 py-3">{prettyStatus(item.status)}</td><td className="max-w-xs px-4 py-3 text-xs text-slate-600">{item.reason}</td>
                  <td className="px-4 py-3 text-xs">{formatDate(item.created_at)}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => { setSelectedId(item.id); setReason(""); setNotes(""); setDecision("not_duplicate"); }} className="rounded border border-blue-200 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">{isAdmin ? "View case" : "Review case"}</button></td>
                </tr>)}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-slate-600">
            <span>{pagination.total} case{pagination.total === 1 ? "" : "s"} · page {pagination.page} of {Math.max(1, pagination.pages)}</span>
            <div className="flex gap-2"><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} className="rounded border p-2 disabled:opacity-40" aria-label="Previous page"><ChevronLeft size={16} /></button><button type="button" disabled={page >= pagination.pages} onClick={() => setPage((value) => value + 1)} className="rounded border p-2 disabled:opacity-40" aria-label="Next page"><ChevronRight size={16} /></button></div>
          </div>
        </>
      )}

      {selected && <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/40 p-3 sm:p-8" role="dialog" aria-modal="true" aria-labelledby="case-heading">
        <section className="mx-auto my-4 max-w-5xl rounded bg-white p-5 shadow-xl sm:p-7">
          <div className="flex items-start justify-between gap-4"><div><h2 id="case-heading" className="text-xl font-bold">Potential match</h2><p className="mt-1 text-sm text-slate-600">{selected.priority} · {prettyStatus(selected.status)} · {selected.model_score != null ? `XGBoost score ${Math.round(selected.model_score * 100)}%` : `Rule score ${Math.round((selected.legacy_rule_score || 0) * 100)}%`} · not a calibrated probability or decision</p>{selected.model_version && <p className="text-xs text-slate-500">Model: {selected.model_version} · cutoff: {selected.review_threshold}</p>}<p className="mt-2 text-sm text-slate-700">{selected.reason}</p></div><button type="button" onClick={() => setSelectedId(null)} className="rounded border px-3 py-1.5 text-sm">Close</button></div>
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {selected.students.map((student) => <article key={student.reference} className="rounded border border-slate-200 p-4"><h3 className="font-semibold">{student.full_name}</h3><p className="mb-3 text-xs text-slate-500">Case reference: {student.reference}</p><dl className="space-y-2 text-sm">{[["Date of birth", student.date_of_birth], ["School identifier (stored value)", student.school_code], ["Guardian", student.guardian_id], ["UPI", student.upi], ["Birth certificate", student.birth_certificate_number], ["National ID", student.national_id_number]].map(([label, value]) => <div key={label} className="flex justify-between gap-3 border-b border-slate-100 pb-1"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium">{value || "Unavailable"}</dd></div>)}</dl></article>)}
          </div>
          <section className="mt-5 rounded border border-slate-200 p-4"><h3 className="font-semibold">Field comparison</h3><dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">{Object.entries(evidenceLabels).map(([key, label]) => <div key={key} className="flex justify-between gap-3"><dt>{label}</dt><dd className="font-medium capitalize">{selected.evidence[key]}</dd></div>)}</dl>{selected.exact_identifier_matches.length > 0 && <p className="mt-3 text-sm font-semibold text-slate-800">Exact match: {selected.exact_identifier_matches.join(", ")}. Verify it; this is not proof of misconduct.</p>}</section>
          <section className="mt-5 rounded border border-slate-200 p-4"><h3 className="font-semibold">Review history</h3>{selected.history.length ? <ol className="mt-2 space-y-3">{selected.history.map((event) => <li key={event.id} className="border-l-2 border-slate-300 pl-3 text-sm"><p className="font-medium">{prettyStatus(event.decision)} · {event.reviewer_name}</p><p className="text-slate-700">Reason: {event.reason}</p>{event.notes && <p className="text-slate-600">Notes: {event.notes}</p>}<time className="text-xs text-slate-500">{formatDate(event.created_at)}</time></li>)}</ol> : <p className="mt-2 text-sm text-slate-500">No previous review actions.</p>}</section>
          {isAdmin && ['pending', 'needs_verification'].includes(selected.status) && <form onSubmit={submitDecision} className="mt-5 rounded border border-slate-200 p-4"><h3 className="font-semibold">Decision</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><button type="button" onClick={() => setDecision("confirmed_duplicate")} aria-pressed={decision === "confirmed_duplicate"} className={`rounded border px-3 py-2 text-sm ${decision === "confirmed_duplicate" ? "border-slate-800 bg-slate-100 font-semibold" : "border-slate-300"}`}>Confirmed duplicate</button><button type="button" onClick={() => setDecision("not_duplicate")} aria-pressed={decision === "not_duplicate"} className={`rounded border px-3 py-2 text-sm ${decision === "not_duplicate" ? "border-slate-800 bg-slate-100 font-semibold" : "border-slate-300"}`}>Not a duplicate</button><button type="button" onClick={() => setDecision("needs_verification")} aria-pressed={decision === "needs_verification"} className={`rounded border px-3 py-2 text-sm ${decision === "needs_verification" ? "border-slate-800 bg-slate-100 font-semibold" : "border-slate-300"}`}>Needs verification</button></div><label className="mt-4 block text-sm font-medium">Reason <span aria-hidden="true">*</span><textarea required minLength={5} maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} rows={3} className="mt-1 w-full border border-slate-300 p-2" placeholder="What did you verify, and why?" /></label><label className="mt-3 block text-sm font-medium">Notes<textarea maxLength={4000} value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 w-full border border-slate-300 p-2" /></label><button type="submit" disabled={saving || reason.trim().length < 5} className="mt-3 rounded bg-slate-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save decision"}</button></form>}
        </section>
      </div>}
    </div>
  );
}

function SummaryCard({ label, value }) {
  return <div className="rounded border border-slate-200 bg-white p-4"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold text-slate-900">{value}</p></div>;
}
