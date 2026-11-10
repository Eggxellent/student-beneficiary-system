import { useEffect, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import AwardCertificatePanel from "../components/AwardCertificatePanel";

const emptyAward = { student_id: "", requested_amount: "" };
const emptyVerification = { award_id: "", outcome: "verified", notes: "", evidence_ref: "" };
const emptyDecision = { award_id: "", decision: "approved", approved_amount: "", reason: "" };

const STATUS_LABELS = {
  submitted: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  not_checked: "Not checked",
  verified: "Verified",
  not_found: "Not found",
  needs_investigation: "Needs a check",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Proposed" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
];

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString()}`;
}

function shortId(value) {
  return value ? value.slice(0, 8).toUpperCase() : "-";
}

function statusText(value) {
  return STATUS_LABELS[String(value || "").toLowerCase()] || String(value || "unverified").replaceAll("_", " ");
}

function Status({ children }) {
  return <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-800">{children}</span>;
}

function Stat({ label, value }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}

export default function Awards() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [students, setStudents] = useState([]);
  const [awards, setAwards] = useState([]);
  const [awardForm, setAwardForm] = useState(emptyAward);
  const [verificationForm, setVerificationForm] = useState(emptyVerification);
  const [decisionForm, setDecisionForm] = useState(emptyDecision);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const requests = [api.get("/awards")];
      if (!isAdmin) requests.push(api.get("/students"));
      const results = await Promise.all(requests);
      setAwards(results[0].data.awards || []);
      if (!isAdmin) setStudents(Array.isArray(results[1].data) ? results[1].data : results[1].data?.value || []);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load awards.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [isAdmin]);

  const pendingAwards = awards.filter((award) => award.status === "submitted");
  const counts = {
    total: awards.length,
    proposed: pendingAwards.length,
    approved: awards.filter((award) => award.status === "approved").length,
    rejected: awards.filter((award) => award.status === "rejected").length,
  };
  const tabs = isAdmin
    ? (pendingAwards.length ? [{ id: "decide", label: "Decide" }] : [])
    : [
      { id: "propose", label: "Propose" },
      ...(pendingAwards.length ? [{ id: "verify", label: "Verify" }] : []),
    ];
  const currentTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : tabs[0]?.id;
  const visibleAwards = statusFilter === "all" ? awards : awards.filter((award) => award.status === statusFilter);

  async function submitAward(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.post("/awards", awardForm);
      setMessage(response.data.message);
      setAwardForm(emptyAward);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to submit award.");
    } finally { setSaving(false); }
  }

  async function submitVerification(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const { award_id, ...payload } = verificationForm;
      const response = await api.post(`/awards/${award_id}/verification`, payload);
      setMessage(response.data.message);
      setVerificationForm(emptyVerification);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to save verification.");
    } finally { setSaving(false); }
  }

  async function submitDecision(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const { award_id, ...payload } = decisionForm;
      if (payload.decision === "rejected") delete payload.approved_amount;
      const response = await api.patch(`/awards/${award_id}/decision`, payload);
      setMessage(response.data.message);
      setDecisionForm(emptyDecision);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to save award decision.");
    } finally { setSaving(false); }
  }

  const field = "mt-1 h-10 w-full rounded border border-slate-300 px-2 text-sm";
  const label = "text-sm font-medium text-slate-800";
  const primary = "rounded bg-[#173D35] px-4 py-2 font-semibold text-white disabled:opacity-50";
  const tabClass = (id) => `rounded px-3 py-1.5 text-sm font-medium ${currentTab === id ? "bg-[#173D35] text-white" : "text-slate-600 hover:bg-slate-100"}`;
  const filterClass = (id) => `rounded-full border px-2.5 py-1 text-xs font-medium ${statusFilter === id ? "border-[#173D35] bg-[#173D35] text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`;

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-5 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Bursary awards</h1>
        <p className="mt-1 text-sm text-slate-600">Propose, verify, then approve. Only an approved award counts &mdash; no payment is implied.</p>
      </header>

      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">{message}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={counts.total} />
        <Stat label="Awaiting decision" value={counts.proposed} />
        <Stat label="Approved" value={counts.approved} />
        <Stat label="Rejected" value={counts.rejected} />
      </div>

      {tabs.length > 0 && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="flex items-center gap-1 border-b border-slate-200 p-2">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={tabClass(tab.id)}>{tab.label}</button>
            ))}
          </div>
          <div className="p-4">
            {currentTab === "propose" && (
              <>
                <p className="mb-3 text-xs text-slate-500">A proposal is not an award; an administrator must approve it.</p>
                <form onSubmit={submitAward} className="grid gap-3 sm:grid-cols-3">
                  <label className={label}>Student
                    <select required value={awardForm.student_id} onChange={(e) => setAwardForm({ ...awardForm, student_id: e.target.value })} className={field}>
                      <option value="">Select student</option>
                      {students.map((student) => <option key={student.id} value={student.id}>{student.full_name} - {student.school_code || "No school"}</option>)}
                    </select>
                  </label>
                  <label className={label}>Amount (KSh)
                    <input required type="number" min="0.01" step="0.01" value={awardForm.requested_amount} onChange={(e) => setAwardForm({ ...awardForm, requested_amount: e.target.value })} className={field} />
                  </label>
                  <button disabled={saving} className={`self-end ${primary}`}>{saving ? "Saving..." : "Propose award"}</button>
                </form>
              </>
            )}

            {currentTab === "verify" && (
              <form onSubmit={submitVerification} className="grid gap-3 sm:grid-cols-2">
                <label className={label}>Proposed award
                  <select required value={verificationForm.award_id} onChange={(e) => setVerificationForm({ ...verificationForm, award_id: e.target.value })} className={field}>
                    <option value="">Select award</option>
                    {pendingAwards.map((award) => <option key={award.id} value={award.id}>{shortId(award.id)} - {award.student_name} - {award.school_code}</option>)}
                  </select>
                </label>
                <label className={label}>Outcome
                  <select value={verificationForm.outcome} onChange={(e) => setVerificationForm({ ...verificationForm, outcome: e.target.value })} className={field}>
                    <option value="verified">Verified</option>
                    <option value="not_found">Not found</option>
                    <option value="needs_investigation">Needs a check</option>
                  </select>
                </label>
                <label className={label}>Notes
                  <input required minLength="5" value={verificationForm.notes} onChange={(e) => setVerificationForm({ ...verificationForm, notes: e.target.value })} className={field} />
                </label>
                <label className={label}>Evidence ref{verificationForm.outcome === "verified" ? " (required)" : ""}
                  <input required={verificationForm.outcome === "verified"} value={verificationForm.evidence_ref} onChange={(e) => setVerificationForm({ ...verificationForm, evidence_ref: e.target.value })} className={field} />
                </label>
                <button disabled={saving} className={`w-fit ${primary}`}>Save verification</button>
              </form>
            )}

            {currentTab === "decide" && (
              <form onSubmit={submitDecision} className="grid gap-3 sm:grid-cols-2">
                <label className={label}>Proposed award
                  <select required value={decisionForm.award_id} onChange={(e) => setDecisionForm({ ...decisionForm, award_id: e.target.value })} className={field}>
                    <option value="">Select award</option>
                    {pendingAwards.map((award) => (
                      <option key={award.id} value={award.id}>
                        {shortId(award.id)} - {award.student_name} - {money(award.requested_amount)} - {statusText(award.verification_status)}{award.open_duplicate_count ? " - duplicate open" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={label}>Decision
                  <select value={decisionForm.decision} onChange={(e) => setDecisionForm({ ...decisionForm, decision: e.target.value })} className={field}>
                    <option value="approved">Approve</option>
                    <option value="rejected">Reject</option>
                  </select>
                </label>
                {decisionForm.decision === "approved" && (
                  <label className={label}>Approved amount (KSh)
                    <input required type="number" min="0.01" step="0.01" value={decisionForm.approved_amount} onChange={(e) => setDecisionForm({ ...decisionForm, approved_amount: e.target.value })} className={field} />
                  </label>
                )}
                <label className={label}>Reason
                  <input required minLength="5" value={decisionForm.reason} onChange={(e) => setDecisionForm({ ...decisionForm, reason: e.target.value })} className={field} />
                </label>
                <button disabled={saving} className={`w-fit ${primary}`}>Save decision</button>
              </form>
            )}
          </div>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-3">
          <h2 className="text-sm font-semibold text-slate-900">Awards ({visibleAwards.length})</h2>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((option) => (
              <button key={option.id} type="button" onClick={() => setStatusFilter(option.id)} className={filterClass(option.id)}>{option.label}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Proposed</th>
                <th className="px-3 py-2">Approved</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleAwards.map((award) => (
                <tr key={award.id}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{award.student_name}</span>
                    <span className="ml-2 text-xs text-slate-500">{award.school_code || shortId(award.id)}</span>
                  </td>
                  <td className="px-3 py-2">{money(award.requested_amount)}</td>
                  <td className="px-3 py-2">{award.approved_amount == null ? "-" : money(award.approved_amount)}</td>
                  <td className="px-3 py-2">
                    <Status>{statusText(award.status)}</Status>
                    {award.open_duplicate_count > 0 && <span className="ml-1 text-xs text-amber-800">duplicate open</span>}
                  </td>
                  <td className="px-3 py-2"><Status>{statusText(award.verification_status)}</Status></td>
                </tr>
              ))}
              {loading && <tr><td colSpan="5" className="px-3 py-6 text-center text-slate-500">Loading...</td></tr>}
              {!loading && visibleAwards.length === 0 && (
                <tr><td colSpan="5" className="px-3 py-6 text-center text-slate-500">No awards{statusFilter === "all" ? " yet" : " with this status"}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <AwardCertificatePanel awards={awards} isAdmin={isAdmin} onChanged={loadData} />
    </main>
  );
}



