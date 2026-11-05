import { useEffect, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import AwardCertificatePanel from "../components/AwardCertificatePanel";

const emptyAward = { student_id: "", requested_amount: "" };
const emptyVerification = { award_id: "", outcome: "verified", notes: "", evidence_ref: "" };
const emptyDecision = { award_id: "", decision: "approved", approved_amount: "", reason: "" };

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString()}`;
}

function shortId(value) {
  return value ? value.slice(0, 8).toUpperCase() : "â€”";
}

function statusText(value) {
  return String(value || "unverified").replaceAll("_", " ");
}

function Status({ children }) {
  return <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium capitalize text-slate-800">{children}</span>;
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

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Bursary awards</h1>
        <p className="mt-1 text-sm text-slate-600">Submit, verify and decide bursary awards. An approved award is a decision record, not a payment.</p>
      </header>

      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">{message}</p>}
      {loading && <p className="text-sm text-slate-600">Loading...</p>}

      {!isAdmin && <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Submit award</h2>
        <form onSubmit={submitAward} className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">Student
            <select required value={awardForm.student_id} onChange={(e) => setAwardForm({ ...awardForm, student_id: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2">
              <option value="">Select student</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.full_name} Â· {student.school_code || "No school"}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Requested amount (KSh)
            <input required type="number" min="0.01" step="0.01" value={awardForm.requested_amount} onChange={(e) => setAwardForm({ ...awardForm, requested_amount: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" />
          </label>
          <button disabled={saving} className="self-end rounded bg-[#173D35] px-4 py-2.5 font-semibold text-white disabled:opacity-50">{saving ? "Saving..." : "Submit award"}</button>
        </form>
      </section>}

      {!isAdmin && pendingAwards.length > 0 && <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Beneficiary verification</h2>
        <form onSubmit={submitVerification} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Submitted award
            <select required value={verificationForm.award_id} onChange={(e) => setVerificationForm({ ...verificationForm, award_id: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2">
              <option value="">Select award</option>
              {pendingAwards.map((award) => <option key={award.id} value={award.id}>{shortId(award.id)} Â· {award.student_name} Â· {award.school_code}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Outcome
            <select value={verificationForm.outcome} onChange={(e) => setVerificationForm({ ...verificationForm, outcome: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2"><option value="verified">Verified</option><option value="not_found">Not found</option><option value="needs_investigation">Needs investigation</option></select>
          </label>
          <label className="text-sm font-medium">Notes
            <input required minLength="5" value={verificationForm.notes} onChange={(e) => setVerificationForm({ ...verificationForm, notes: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" />
          </label>
          <label className="text-sm font-medium">Evidence reference {verificationForm.outcome === "verified" && <span aria-hidden="true">*</span>}
            <input required={verificationForm.outcome === "verified"} value={verificationForm.evidence_ref} onChange={(e) => setVerificationForm({ ...verificationForm, evidence_ref: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" />
          </label>
          <button disabled={saving} className="w-fit rounded bg-[#173D35] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Save verification</button>
        </form>
      </section>}

      {isAdmin && pendingAwards.length > 0 && <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Award decision</h2>
        <form onSubmit={submitDecision} className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Submitted award
            <select required value={decisionForm.award_id} onChange={(e) => setDecisionForm({ ...decisionForm, award_id: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2">
              <option value="">Select award</option>
              {pendingAwards.map((award) => <option key={award.id} value={award.id}>{shortId(award.id)} Â· {award.student_name} Â· requested {money(award.requested_amount)} Â· {statusText(award.verification_status)}{award.open_duplicate_count ? " Â· duplicate review open" : ""}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Decision
            <select value={decisionForm.decision} onChange={(e) => setDecisionForm({ ...decisionForm, decision: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2"><option value="approved">Approve</option><option value="rejected">Reject</option></select>
          </label>
          {decisionForm.decision === "approved" && <label className="text-sm font-medium">Approved amount (KSh)
            <input required type="number" min="0.01" step="0.01" value={decisionForm.approved_amount} onChange={(e) => setDecisionForm({ ...decisionForm, approved_amount: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" />
          </label>}
          <label className="text-sm font-medium">Decision reason
            <input required minLength="5" value={decisionForm.reason} onChange={(e) => setDecisionForm({ ...decisionForm, reason: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" />
          </label>
          <button disabled={saving} className="w-fit rounded bg-[#173D35] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Save decision</button>
        </form>
      </section>}

      <section className="overflow-x-auto rounded border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <h2 className="font-semibold text-slate-900">Awards</h2>
          <span className="text-sm text-slate-600">{awards.length} total</span>
        </div>
        <table className="w-full min-w-[700px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-3">Award</th><th className="p-3">Student / school</th><th className="p-3">Requested</th><th className="p-3">Approved</th><th className="p-3">Status</th><th className="p-3">Verification</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {awards.map((award) => <tr key={award.id}>
              <td className="p-3 font-mono text-xs">{shortId(award.id)}</td>
              <td className="p-3">{award.student_name}<div className="text-xs text-slate-500">{award.school_code}</div></td>
              <td className="p-3">{money(award.requested_amount)}</td>
              <td className="p-3">{award.approved_amount == null ? "â€”" : money(award.approved_amount)}</td>
              <td className="p-3"><Status>{award.status}</Status>{award.open_duplicate_count > 0 && <div className="mt-1 text-xs text-amber-800">Duplicate review open</div>}</td>
              <td className="p-3"><Status>{award.verification_status}</Status></td>
            </tr>)}
            {!loading && awards.length === 0 && <tr><td colSpan="6" className="p-6 text-center text-slate-500">No awards.</td></tr>}
          </tbody>
        </table>
      </section>

      <AwardCertificatePanel awards={awards} isAdmin={isAdmin} onChanged={loadData} />
    </main>
  );
}
