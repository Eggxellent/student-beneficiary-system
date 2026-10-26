import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const emptyAward = { student_id: "", requested_amount: "" };
const emptyVerification = { award_id: "", outcome: "verified", notes: "", evidence_ref: "" };
const emptyDecision = { award_id: "", decision: "approved", approved_amount: "", reason: "" };
const emptyPayment = { award_id: "", amount: "", payment_method: "", payment_reference: "", disbursement_date: new Date().toISOString().slice(0, 10) };

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString()}`;
}

function shortId(value) {
  return value ? value.slice(0, 8).toUpperCase() : "—";
}

function statusText(value) {
  return String(value || "unverified").replaceAll("_", " ");
}

function Status({ children }) {
  return <span className="inline-block rounded border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium capitalize text-slate-800">{children}</span>;
}

export default function Disbursements() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [students, setStudents] = useState([]);
  const [awards, setAwards] = useState([]);
  const [payments, setPayments] = useState([]);
  const [deadlineDays, setDeadlineDays] = useState(null);
  const [awardForm, setAwardForm] = useState(emptyAward);
  const [verificationForm, setVerificationForm] = useState(emptyVerification);
  const [decisionForm, setDecisionForm] = useState(emptyDecision);
  const [paymentForm, setPaymentForm] = useState(emptyPayment);
  const [activeAction, setActiveAction] = useState(null);
  const [statusForm, setStatusForm] = useState({ payment_status: "cleared", evidence_ref: "", notes: "" });
  const [receiptForm, setReceiptForm] = useState({ acknowledged_amount: "", evidence_ref: "", notes: "" });
  const [legacyLink, setLegacyLink] = useState({ award_id: "", reason: "" });
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("exceptions");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function loadData() {
    setLoading(true);
    setError("");
    try {
      const requests = [api.get("/awards"), api.get("/disbursements"), api.get("/disbursements/exceptions")];
      if (!isAdmin) requests.push(api.get("/students"));
      const results = await Promise.all(requests);
      setAwards(results[0].data.awards || []);
      setPayments(Array.isArray(results[1].data) ? results[1].data : []);
      setDeadlineDays(results[2].data.deadline_days ?? null);
      if (!isAdmin) setStudents(Array.isArray(results[3].data) ? results[3].data : results[3].data?.value || []);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load awards and payments.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, [isAdmin]);

  const pendingAwards = awards.filter((award) => award.status === "submitted");
  const verifiedAwards = awards.filter((award) => award.status === "approved" && award.verification_status === "verified");
  const eligibleAwards = verifiedAwards.filter((award) => Number(award.total_disbursed || 0) < Number(award.approved_amount || 0));
  const visiblePayments = useMemo(() => payments.filter((payment) => {
    const text = `${payment.award_reference || ""} ${payment.student_name || ""} ${payment.award_school_code || ""} ${payment.payment_status || "unverified"} ${(payment.exception_reasons || []).join(" ")}`.toLowerCase();
    if (!text.includes(query.toLowerCase())) return false;
    return filter !== "exceptions" || payment.exception_reasons?.length > 0;
  }), [payments, query, filter]);

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

  async function submitPayment(event) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.post("/disbursements", paymentForm);
      setMessage(response.data.message);
      setPaymentForm(emptyPayment);
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to record payment.");
    } finally { setSaving(false); }
  }

  async function submitPaymentStatus(event, paymentId) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.patch(`/disbursements/${paymentId}/payment-status`, statusForm);
      setMessage(response.data.message);
      setActiveAction(null);
      setStatusForm({ payment_status: "cleared", evidence_ref: "", notes: "" });
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to update payment status.");
    } finally { setSaving(false); }
  }

  async function submitReceipt(event, paymentId) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.patch(`/disbursements/${paymentId}/acknowledgement`, receiptForm);
      setMessage(response.data.message);
      setActiveAction(null);
      setReceiptForm({ acknowledged_amount: "", evidence_ref: "", notes: "" });
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to record receipt.");
    } finally { setSaving(false); }
  }

  async function submitLegacyLink(event, paymentId) {
    event.preventDefault();
    setError(""); setMessage(""); setSaving(true);
    try {
      const response = await api.patch(`/disbursements/${paymentId}/award`, legacyLink);
      setMessage(response.data.message);
      setActiveAction(null);
      setLegacyLink({ award_id: "", reason: "" });
      await loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Unable to link payment to an award.");
    } finally { setSaving(false); }
  }

  return (
    <main className="mx-auto max-w-7xl space-y-6 p-5 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Awards and payments</h1>
        <p className="mt-1 text-sm text-slate-600">Issued, cleared and received are tracked separately.</p>
      </header>

      {deadlineDays == null && <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Overdue alerts are off. Configure <code>ACKNOWLEDGEMENT_OVERDUE_DAYS</code>.</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
      {message && <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800" role="status">{message}</p>}
      {loading && <p className="text-sm text-slate-600">Loading...</p>}

      {!isAdmin && <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Submit award</h2>
        <form onSubmit={submitAward} className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">Student
            <select required value={awardForm.student_id} onChange={(e) => setAwardForm({ ...awardForm, student_id: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2">
              <option value="">Select student</option>
              {students.map((student) => <option key={student.id} value={student.id}>{student.full_name} · {student.school_code || "No school"}</option>)}
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
              {pendingAwards.map((award) => <option key={award.id} value={award.id}>{shortId(award.id)} · {award.student_name} · {award.school_code}</option>)}
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
              {pendingAwards.map((award) => <option key={award.id} value={award.id}>{shortId(award.id)} · {award.student_name} · requested {money(award.requested_amount)} · {statusText(award.verification_status)}{award.open_duplicate_count ? " · duplicate review open" : ""}</option>)}
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
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-3">Award</th><th className="p-3">Student / school</th><th className="p-3">Requested</th><th className="p-3">Approved</th><th className="p-3">Status</th><th className="p-3">Verification</th><th className="p-3">Paid</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {awards.map((award) => <tr key={award.id}>
              <td className="p-3 font-mono text-xs">{shortId(award.id)}</td>
              <td className="p-3">{award.student_name}<div className="text-xs text-slate-500">{award.school_code}</div></td>
              <td className="p-3">{money(award.requested_amount)}</td>
              <td className="p-3">{award.approved_amount == null ? "—" : money(award.approved_amount)}</td>
              <td className="p-3"><Status>{award.status}</Status>{award.open_duplicate_count > 0 && <div className="mt-1 text-xs text-amber-800">Duplicate review open</div>}</td>
              <td className="p-3"><Status>{award.verification_status}</Status></td>
              <td className="p-3">{money(award.total_disbursed)}</td>
            </tr>)}
            {!loading && awards.length === 0 && <tr><td colSpan="7" className="p-6 text-center text-slate-500">No awards.</td></tr>}
          </tbody>
        </table>
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-900">Issue payment</h2>
        {eligibleAwards.length === 0 ? <p className="mt-2 text-sm text-slate-600">No approved award has a remaining balance.</p> : <form onSubmit={submitPayment} className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-medium lg:col-span-2">Award
            <select required value={paymentForm.award_id} onChange={(e) => setPaymentForm({ ...paymentForm, award_id: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2">
              <option value="">Select award</option>
              {eligibleAwards.map((award) => <option key={award.id} value={award.id}>{shortId(award.id)} · {award.student_name} · remaining {money(Number(award.approved_amount) - Number(award.total_disbursed))}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium">Amount (KSh)<input required type="number" min="0.01" step="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" /></label>
          <label className="text-sm font-medium">Payment method<input required maxLength="80" value={paymentForm.payment_method} onChange={(e) => setPaymentForm({ ...paymentForm, payment_method: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" placeholder="As recorded" /></label>
          <label className="text-sm font-medium">Payment date<input required type="date" value={paymentForm.disbursement_date} onChange={(e) => setPaymentForm({ ...paymentForm, disbursement_date: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" /></label>
          <label className="text-sm font-medium lg:col-span-2">Reference (if available)<input maxLength="150" value={paymentForm.payment_reference} onChange={(e) => setPaymentForm({ ...paymentForm, payment_reference: e.target.value })} className="mt-1 h-10 w-full border border-slate-300 px-2" /></label>
          <button disabled={saving} className="w-fit self-end rounded bg-[#173D35] px-4 py-2.5 font-semibold text-white disabled:opacity-50">Record issued payment</button>
        </form>}
      </section>

      <section className="overflow-x-auto rounded border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-end sm:justify-between">
          <div><h2 className="font-semibold text-slate-900">Payment exceptions</h2><p className="mt-1 text-xs text-slate-600">Exceptions need follow-up; they do not prove loss or fraud.</p></div>
          <div className="flex gap-2">
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search award, student, school" className="h-10 border border-slate-300 px-3 text-sm" />
            <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Payment filter" className="h-10 border border-slate-300 px-2 text-sm"><option value="exceptions">Exceptions</option><option value="all">All payments</option></select>
          </div>
        </div>
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600"><tr><th className="p-3">Award / student</th><th className="p-3">School</th><th className="p-3">Amount</th><th className="p-3">Payment</th><th className="p-3">Receipt</th><th className="p-3">Exception</th><th className="p-3">Action</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {visiblePayments.map((payment) => <PaymentRow key={payment.id} payment={payment} isAdmin={isAdmin} awards={awards} activeAction={activeAction} setActiveAction={setActiveAction} statusForm={statusForm} setStatusForm={setStatusForm} receiptForm={receiptForm} setReceiptForm={setReceiptForm} legacyLink={legacyLink} setLegacyLink={setLegacyLink} saving={saving} submitPaymentStatus={submitPaymentStatus} submitReceipt={submitReceipt} submitLegacyLink={submitLegacyLink} />)}
            {!loading && visiblePayments.length === 0 && <tr><td colSpan="7" className="p-8 text-center text-slate-500">No matching payments.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function PaymentRow({ payment, isAdmin, awards, activeAction, setActiveAction, statusForm, setStatusForm, receiptForm, setReceiptForm, legacyLink, setLegacyLink, saving, submitPaymentStatus, submitReceipt, submitLegacyLink }) {
  const actionType = activeAction?.id === payment.id ? activeAction.type : null;
  const linkedAwards = awards.filter((award) => award.student_id === payment.student_id && award.status === "approved");
  return <>
    <tr>
      <td className="p-3"><span className="font-mono text-xs">{shortId(payment.award_reference)}</span><div className="font-medium">{payment.student_name}</div><div className="text-xs text-slate-500">{payment.award_id ? `Payment ${shortId(payment.id)}` : `Legacy payment ${shortId(payment.id)}`}</div></td>
      <td className="p-3">{payment.award_school_code || "—"}</td>
      <td className="p-3">{money(payment.amount)}{payment.acknowledged_amount != null && <div className="text-xs text-slate-500">Received: {money(payment.acknowledged_amount)}</div>}</td>
      <td className="p-3"><Status>{statusText(payment.payment_status || "unverified")}</Status></td>
      <td className="p-3"><Status>{statusText(payment.receipt_status || "unknown")}</Status></td>
      <td className="max-w-xs p-3 text-xs text-amber-900">{payment.exception_reasons?.length ? payment.exception_reasons.join(" · ") : "—"}</td>
      <td className="p-3"><div className="flex flex-wrap gap-2">
        {(payment.payment_status === "issued" || !payment.payment_status) && <button type="button" onClick={() => { setActiveAction({ id: payment.id, type: actionType === "status" ? null : "status" }); setStatusForm({ payment_status: "cleared", evidence_ref: "", notes: "" }); }} className="rounded border px-2 py-1 text-xs font-medium">{payment.payment_status ? "Update status" : "Verify status"}</button>}
        {!['failed', 'cancelled'].includes(payment.payment_status) && <button type="button" onClick={() => { setActiveAction({ id: payment.id, type: actionType === "receipt" ? null : "receipt" }); setReceiptForm({ acknowledged_amount: payment.acknowledged_amount ?? payment.amount, evidence_ref: payment.acknowledgement_evidence_ref || "", notes: payment.acknowledgement_notes || "" }); }} className="rounded border px-2 py-1 text-xs font-medium">{payment.receipt_status === "acknowledged" ? "Update receipt" : "Record receipt"}</button>}
        {isAdmin && !payment.award_id && linkedAwards.length > 0 && <button type="button" onClick={() => { setActiveAction({ id: payment.id, type: actionType === "link" ? null : "link" }); setLegacyLink({ award_id: "", reason: "" }); }} className="rounded border px-2 py-1 text-xs font-medium">Link award</button>}
        <details className="relative"><summary className="cursor-pointer rounded border px-2 py-1 text-xs">History</summary><div className="absolute right-0 z-10 mt-1 max-h-56 w-80 overflow-auto rounded border bg-white p-3 shadow-lg">{payment.reconciliation_history?.length ? payment.reconciliation_history.map((event, index) => <p key={`${event.created_at}-${index}`} className="border-b py-2 text-xs"><strong className="capitalize">{statusText(event.event_type)}</strong> · {event.actor_name} · {new Date(event.created_at).toLocaleString()}{event.evidence_ref && <span className="block text-slate-600">Evidence: {event.evidence_ref}</span>}{event.notes && <span className="block text-slate-600">{event.notes}</span>}</p>) : <p className="text-xs text-slate-600">No reconciliation events.</p>}</div></details>
      </div></td>
    </tr>
    {actionType === "status" && <tr><td colSpan="7" className="bg-slate-50 p-3"><form onSubmit={(event) => submitPaymentStatus(event, payment.id)} className="grid gap-2 sm:grid-cols-4">
      <label className="text-xs font-medium">New status<select value={statusForm.payment_status} onChange={(e) => setStatusForm({ ...statusForm, payment_status: e.target.value })} className="mt-1 h-9 w-full border px-2"><option value="cleared">Cleared</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
      {statusForm.payment_status === "cleared" && <label className="text-xs font-medium">Evidence reference<input required value={statusForm.evidence_ref} onChange={(e) => setStatusForm({ ...statusForm, evidence_ref: e.target.value })} className="mt-1 h-9 w-full border px-2" /></label>}
      {statusForm.payment_status !== "cleared" && <label className="text-xs font-medium">Reason<input required minLength="5" value={statusForm.notes} onChange={(e) => setStatusForm({ ...statusForm, notes: e.target.value })} className="mt-1 h-9 w-full border px-2" /></label>}
      <button disabled={saving} className="self-end rounded bg-[#173D35] px-3 py-2 text-xs font-semibold text-white">Save status</button>
    </form></td></tr>}
    {actionType === "receipt" && <tr><td colSpan="7" className="bg-slate-50 p-3"><form onSubmit={(event) => submitReceipt(event, payment.id)} className="grid gap-2 sm:grid-cols-4">
      <label className="text-xs font-medium">Amount received (KSh)<input required type="number" min="0" step="0.01" value={receiptForm.acknowledged_amount} onChange={(e) => setReceiptForm({ ...receiptForm, acknowledged_amount: e.target.value })} className="mt-1 h-9 w-full border px-2" /></label>
      <label className="text-xs font-medium">Evidence reference<input required value={receiptForm.evidence_ref} onChange={(e) => setReceiptForm({ ...receiptForm, evidence_ref: e.target.value })} className="mt-1 h-9 w-full border px-2" /></label>
      <label className="text-xs font-medium">Notes<input value={receiptForm.notes} onChange={(e) => setReceiptForm({ ...receiptForm, notes: e.target.value })} className="mt-1 h-9 w-full border px-2" /></label>
      <button disabled={saving} className="self-end rounded bg-[#173D35] px-3 py-2 text-xs font-semibold text-white">Save officer-assisted receipt</button>
    </form><p className="mt-2 text-xs text-slate-600">This records an officer-assisted acknowledgement, not independent school confirmation.</p></td></tr>}
    {actionType === "link" && <tr><td colSpan="7" className="bg-slate-50 p-3"><form onSubmit={(event) => submitLegacyLink(event, payment.id)} className="grid gap-2 sm:grid-cols-3">
      <label className="text-xs font-medium">Approved award<select required value={legacyLink.award_id} onChange={(e) => setLegacyLink({ ...legacyLink, award_id: e.target.value })} className="mt-1 h-9 w-full border px-2"><option value="">Select award</option>{linkedAwards.map((award) => <option key={award.id} value={award.id}>{shortId(award.id)} · {money(award.approved_amount)}</option>)}</select></label>
      <label className="text-xs font-medium">Link reason<input required minLength="5" value={legacyLink.reason} onChange={(e) => setLegacyLink({ ...legacyLink, reason: e.target.value })} className="mt-1 h-9 w-full border px-2" /></label>
      <button disabled={saving} className="self-end rounded bg-[#173D35] px-3 py-2 text-xs font-semibold text-white">Link payment</button>
    </form><p className="mt-2 text-xs text-slate-600">This links the record only. Payment clearance and receipt remain unverified until recorded.</p></td></tr>}
  </>;
}
