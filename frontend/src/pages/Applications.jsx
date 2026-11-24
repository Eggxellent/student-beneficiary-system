import { useEffect, useMemo, useState } from "react";
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
};

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



  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Guardian applications</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Every guardian submission and the student record it created. A submission whose student
            record is missing was stored before the linkage pipeline and can be repaired with
            <code className="mx-1 rounded bg-slate-100 px-1 py-0.5 text-xs">
              npm run db:link-guardian-applications -- --apply
            </code>
            (dry run by default).
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

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Reference</th>
              <th className="px-4 py-3 font-medium">Student</th>
              <th className="px-4 py-3 font-medium">Guardian account</th>
              <th className="px-4 py-3 font-medium">School</th>
              <th className="px-4 py-3 font-medium">Submitted</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Student record</th>
              <th className="px-4 py-3 font-medium">Screening / assessment</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((application) => (
              <tr
                key={application.id}
                onClick={() => {
                  setSelectedId(application.id);
                  setNote(application.detail?.decisionNote || "");
                  setNotice("");
                }}
                className={`cursor-pointer align-top text-slate-700 hover:bg-slate-50 ${
                  application.id === selectedId ? "bg-blue-50/60" : ""
                }`}
              >
                <td className="px-4 py-4 font-medium text-slate-900">{application.reference}</td>
                <td className="px-4 py-4">
                  <p>{application.student}</p>
                  <p className="mt-1 text-xs text-slate-500">{application.school}</p>
                </td>
                <td className="px-4 py-4">
                  <p>{application.guardianAccount}</p>
                  <p className="mt-1 text-xs text-slate-500">{application.guardianEmail}</p>
                </td>
                <td className="px-4 py-4">{application.school}</td>
                <td className="px-4 py-4">{shortDate(application.submitted_at)}</td>
                <td className="px-4 py-4">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[application.status_code] || STATUS_STYLES.submitted}`}>
                    {application.status}
                  </span>
                </td>
                <td className="px-4 py-4">
                  {application.registeredStudent ? (
                    <>
                      <p>{application.registeredStudent.full_name}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {application.registeredStudent.upi || "UPI not captured"}
                      </p>
                    </>
                  ) : (
                    <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">
                      Not linked
                    </span>
                  )}
                </td>
                <td className="px-4 py-4">
                  {application.duplicate ? (
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${DUPLICATE_STYLES[application.duplicate.status] || DUPLICATE_STYLES.pending}`}>
                      {label(application.duplicate.status)}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-500">No duplicate flag</span>
                  )}
                  <p className="mt-1 text-xs text-slate-500">
                    {application.assessment
                      ? `${label(application.assessment.status)} assessment${
                          application.assessment.score === null
                            ? ""
                            : ` · ${application.assessment.score}/100`
                        }`
                      : "No assessment yet"}
                  </p>
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan="8" className="px-4 py-10 text-center text-slate-500">
                  No guardian applications match this filter.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan="8" className="px-4 py-10 text-center text-slate-500">
                  Loading applications...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <section className="mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
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
              This application has no student record. Duplicate screening, eligibility and the Field
              Officer screens cannot see it until it is linked. Run the repair script with
              <code className="mx-1 rounded bg-white px-1 py-0.5 text-xs">--apply</code>
              to create the student from this application.
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

          {selected.detail?.documents?.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-800">Supporting documents</h3>
              <ul className="mt-1 list-disc pl-5 text-sm text-slate-600">
                {selected.detail.documents.map((document) => (
                  <li key={document.name}>
                    {document.name} — {document.description}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <label htmlFor="decision-note" className="text-sm font-medium text-slate-800">
              Decision note
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
                Approve application
              </button>
              <button
                type="button"
                disabled={saving}
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
          </div>
        </section>
      )}
    </main>
  );
}


