import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import AwardCertificatePanel from "../components/AwardCertificatePanel";

const emptyAward = { student_id: "", requested_amount: "" };
const emptyDecision = { award_id: "", decision: "approved", approved_amount: "", reason: "" };
const emptyReport = { award_id: "", reason: "" };
const emptyCorrection = { award_id: "", approved_amount: "", reason: "" };
const emptyVoid = { award_id: "", reason: "" };

const STATUS_LABELS = {
  submitted: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  voided: "Voided",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "submitted", label: "Proposed" },
  { id: "approved", label: "Approved" },
  { id: "rejected", label: "Rejected" },
  { id: "voided", label: "Voided" },
];

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString()}`;
}

function shortId(value) {
  return value ? value.slice(0, 8).toUpperCase() : "-";
}

function statusText(value) {
  return STATUS_LABELS[String(value || "").toLowerCase()] || String(value || "unknown").replaceAll("_", " ");
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
  const [decisionForm, setDecisionForm] = useState(emptyDecision);
  const [reportForm, setReportForm] = useState(emptyReport);
  const [correctionForm, setCorrectionForm] = useState(emptyCorrection);
  const [voidForm, setVoidForm] = useState(emptyVoid);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState("all");
  // Collapsed by default for both roles: the page opens as a short list of section headers instead of
  // a long scroll. The count in the header still shows how many awards match the current filter.
  const [awardsOpen, setAwardsOpen] = useState(false);

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
  // One bursary per student per calendar year. A proposal or an approval occupies the year; a
  // rejected or voided award does not. The API enforces the same rule, so this copy only prevents a
  // pointless request when the page already knows the answer.
  const currentYear = new Date().getFullYear();
  const awardedStudentIds = new Set(
    awards
      .filter((award) => ["submitted", "approved"].includes(award.status)
        && Number(award.award_year) === currentYear)
      .map((award) => award.student_id)
  );
  const openReports = awards.filter((award) => award.open_report_id);
  const reportableAwards = awards.filter((award) => ["submitted", "approved"].includes(award.status)
    && award.submitted_by === user?.id);
  const counts = {
    total: awards.length,
    proposed: pendingAwards.length,
    approved: awards.filter((award) => award.status === "approved").length,
    rejected: awards.filter((award) => award.status === "rejected").length,
  };
  // Each role only ever had one reachable tab, so the strip was a no-op click target. The form is
  // rendered directly instead: administrators decide, field officers propose the award amount.
  const showDecision = isAdmin && pendingAwards.length > 0;
  const showProposal = !isAdmin;
  const visibleAwards = statusFilter === "all" ? awards : awards.filter((award) => award.status === statusFilter);

  async function submitAward(event) {
    event.preventDefault();
    // A ref, not the state flag: two clicks in the same tick both read `saving === false`.
    if (submittingRef.current) return;
    setError(""); setMessage("");
    submittingRef.current = true;
    setSaving(true);
    try {
      const response = await api.post("/awards", awardForm);
      setMessage(response.data.message);
      setAwardForm(emptyAward);
      await loadData();
    } catch (err) {
      // The server refuses a second award for the same student and year; its message explains why
      // and points at the report-an-error path.
      setError(err.response?.data?.message || "Unable to submit award.");
    } finally { submittingRef.current = false; setSaving(false); }
  }

  async function submitReport(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.post(`/awards/${reportForm.award_id}/error-report`, { reason: reportForm.reason });
      setMessage(response.data.message);
      setReportForm(emptyReport);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to report the error.");
    } finally { setSaving(false); }
  }

  async function submitCorrection(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.patch(`/awards/${correctionForm.award_id}/correction`, {
        approved_amount: Number(correctionForm.approved_amount),
        reason: correctionForm.reason,
      });
      setMessage(response.data.message);
      setCorrectionForm(emptyCorrection);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to correct the award.");
    } finally { setSaving(false); }
  }

  async function submitVoid(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.post(`/awards/${voidForm.award_id}/void`, { reason: voidForm.reason });
      setMessage(response.data.message);
      setVoidForm(emptyVoid);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to void the award.");
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
  const filterClass = (id) => `rounded-full border px-2.5 py-1 text-xs font-medium ${statusFilter === id ? "border-[#173D35] bg-[#173D35] text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"}`;

  return (
    <main className="mx-auto max-w-7xl space-y-5 p-5 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Bursary awards</h1>
        <p className="mt-1 text-sm text-slate-600">The field officer proposes, an administrator decides. One bursary per student per calendar year. Only an approved award counts &mdash; its bursary approval invoice is generated automatically for printing. No payment is implied.</p>
      </header>

      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">{message}</p>}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={counts.total} />
        <Stat label="Awaiting decision" value={counts.proposed} />
        <Stat label="Approved" value={counts.approved} />
        <Stat label="Rejected" value={counts.rejected} />
      </div>

      {(showProposal || showDecision) && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="p-4">
            {showProposal && (
              <>
                <p className="mb-3 text-xs text-slate-500">A proposal is not an award; an administrator must approve it.</p>
                <form onSubmit={submitAward} className="grid gap-3 sm:grid-cols-3">
                  <label className={label}>Student
                    <select required value={awardForm.student_id} onChange={(e) => setAwardForm({ ...awardForm, student_id: e.target.value })} className={field}>
                      <option value="">Select student</option>
                      {students.map((student) => (
                        <option key={student.id} value={student.id} disabled={awardedStudentIds.has(student.id)}>
                          {student.full_name} - {student.school_code || "No school"}
                          {awardedStudentIds.has(student.id) ? ` (bursary already awarded for ${currentYear})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={label}>Amount (KSh)
                    <input required type="number" min="0.01" step="0.01" value={awardForm.requested_amount} onChange={(e) => setAwardForm({ ...awardForm, requested_amount: e.target.value })} className={field} />
                  </label>
                  <button disabled={saving || awardedStudentIds.has(awardForm.student_id)} className={`self-end ${primary}`}>{saving ? "Saving..." : "Propose award"}</button>
                </form>
                <p className="mt-2 text-xs text-slate-500">
                  A student can receive one bursary per calendar year ({currentYear}). A proposal occupies the year until it is decided.
                </p>
                {!students.length && (
                  <p className="mt-2 text-xs text-slate-500">No students are registered yet, so there is nobody to propose an award for.</p>
                )}
              </>
            )}

            {showDecision && (
              <form onSubmit={submitDecision} className="grid gap-3 sm:grid-cols-2">
                <label className={label}>Proposed award
                  <select required value={decisionForm.award_id} onChange={(e) => setDecisionForm({ ...decisionForm, award_id: e.target.value })} className={field}>
                    <option value="">Select award</option>
                    {pendingAwards.map((award) => (
                      <option key={award.id} value={award.id}>
                        {shortId(award.id)} - {award.student_name} - {money(award.requested_amount)}
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

      {!isAdmin && reportableAwards.some((award) => !award.open_report_id) && (
        <section className="rounded border border-slate-200 bg-white">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Report an error in an award</h2>
            <p className="mt-1 text-xs text-slate-500">
              A wrong award cannot be replaced with a second one. Report it here; an administrator will correct or void it.
            </p>
            <form onSubmit={submitReport} className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className={label}>Award
                <select required value={reportForm.award_id} onChange={(e) => setReportForm({ ...reportForm, award_id: e.target.value })} className={field}>
                  <option value="">Select award</option>
                  {reportableAwards.filter((award) => !award.open_report_id).map((award) => (
                    <option key={award.id} value={award.id}>
                      {shortId(award.id)} - {award.student_name} - {money(award.approved_amount ?? award.requested_amount)}
                    </option>
                  ))}
                </select>
              </label>
              <label className={label}>What is wrong?
                <input required minLength="5" value={reportForm.reason} onChange={(e) => setReportForm({ ...reportForm, reason: e.target.value })} className={field} />
              </label>
              <button disabled={saving} className={primary}>Report error</button>
            </form>
            {reportableAwards.some((award) => award.open_report_id) && (
              <p className="mt-2 text-xs text-amber-700">An award you reported is already awaiting an administrator's decision.</p>
            )}
          </div>
        </section>
      )}

      {isAdmin && openReports.length > 0 && (
        <section className="rounded border border-amber-300 bg-amber-50">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-slate-900">Reported award errors ({openReports.length})</h2>
            <ul className="mt-2 space-y-2">
              {openReports.map((award) => (
                <li key={award.id} className="rounded border border-amber-200 bg-white p-2 text-xs text-slate-700">
                  <span className="font-semibold text-slate-900">{award.student_name}</span> - {statusText(award.status)} - {money(award.approved_amount ?? award.requested_amount)} for {award.award_year}
                  <span className="block text-slate-500">
                    Reported by {award.open_report_reported_by_name || "a field officer"}
                    {award.open_report_at ? ` on ${new Date(award.open_report_at).toLocaleDateString()}` : ""}
                  </span>
                  <span className="mt-1 block text-slate-700">&ldquo;{award.open_report_reason}&rdquo;</span>
                </li>
              ))}
            </ul>

            <form onSubmit={submitCorrection} className="mt-4 grid gap-3 border-t border-amber-200 pt-3 sm:grid-cols-2">
              <label className={label}>Correct award
                <select required value={correctionForm.award_id} onChange={(e) => {
                  const award = openReports.find((item) => item.id === e.target.value);
                  setCorrectionForm({ ...correctionForm, award_id: e.target.value, approved_amount: award?.approved_amount ?? "" });
                }} className={field}>
                  <option value="">Select award</option>
                  {openReports.filter((award) => award.status === "approved").map((award) => (
                    <option key={award.id} value={award.id}>{shortId(award.id)} - {award.student_name}</option>
                  ))}
                </select>
              </label>
              <label className={label}>Corrected approved amount (KSh)
                <input required type="number" min="0.01" step="0.01" value={correctionForm.approved_amount} onChange={(e) => setCorrectionForm({ ...correctionForm, approved_amount: e.target.value })} className={field} />
              </label>
              <label className={label}>Reason for the correction
                <input required minLength="5" value={correctionForm.reason} onChange={(e) => setCorrectionForm({ ...correctionForm, reason: e.target.value })} className={field} />
              </label>
              <button disabled={saving} className={`w-fit self-end ${primary}`}>Correct award</button>
            </form>

            <form onSubmit={submitVoid} className="mt-4 grid gap-3 border-t border-amber-200 pt-3 sm:grid-cols-2">
              <label className={label}>Void award
                <select required value={voidForm.award_id} onChange={(e) => setVoidForm({ ...voidForm, award_id: e.target.value })} className={field}>
                  <option value="">Select award</option>
                  {openReports.map((award) => (
                    <option key={award.id} value={award.id}>{shortId(award.id)} - {award.student_name} - {statusText(award.status)}</option>
                  ))}
                </select>
              </label>
              <label className={label}>Reason for voiding (required)
                <input required minLength="5" value={voidForm.reason} onChange={(e) => setVoidForm({ ...voidForm, reason: e.target.value })} className={field} />
              </label>
              <button disabled={saving} className="w-fit self-end rounded border border-red-300 bg-white px-4 py-2 font-semibold text-red-700 disabled:opacity-50">Void award</button>
            </form>
            <p className="mt-2 text-xs text-slate-600">
              A corrected award still counts as the student&rsquo;s bursary for that year. Voiding frees the year once it is completed and keeps the original record.
            </p>
          </div>
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white">
        <div className={`flex flex-wrap items-center justify-between gap-2 p-3 ${awardsOpen ? "border-b border-slate-200" : ""}`}>
          <button
            type="button"
            onClick={() => setAwardsOpen((value) => !value)}
            aria-expanded={awardsOpen}
            className="flex items-center gap-1.5 text-sm font-semibold text-slate-900"
          >
            <ChevronDown size={16} aria-hidden="true" className={`transition-transform ${awardsOpen ? "" : "-rotate-90"}`} />
            Awards ({visibleAwards.length})
            <span className="text-xs font-normal text-slate-500">{awardsOpen ? "Minimize" : "Expand"}</span>
          </button>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((option) => (
              <button key={option.id} type="button" onClick={() => setStatusFilter(option.id)} className={filterClass(option.id)}>{option.label}</button>
            ))}
          </div>
        </div>
        {awardsOpen && (
        <div id="awards-table" className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">Student</th>
                <th className="px-3 py-2">Proposed</th>
                <th className="px-3 py-2">Approved</th>
                <th className="px-3 py-2">Status</th>
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
                  <td className="px-3 py-2"><Status>{statusText(award.status)}</Status>
                    {award.open_report_id && <span className="ml-2 text-xs text-amber-700">error reported</span>}
                  </td>
                </tr>
              ))}
              {loading && <tr><td colSpan="4" className="px-3 py-6 text-center text-slate-500">Loading...</td></tr>}
              {!loading && visibleAwards.length === 0 && (
                <tr><td colSpan="4" className="px-3 py-6 text-center text-slate-500">No awards{statusFilter === "all" ? " yet" : " with this status"}.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        )}
      </section>

      <AwardCertificatePanel awards={awards} isAdmin={isAdmin} currentUserId={user?.id} />
    </main>
  );
}



