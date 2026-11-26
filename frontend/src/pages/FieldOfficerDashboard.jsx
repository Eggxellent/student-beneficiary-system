import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, ClipboardList, Users } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const CARD_CLASS = "rounded-xl border border-slate-200 bg-white shadow-sm";

const METRIC_DOT = {
  registered: "bg-blue-500",
  attention: "bg-amber-500",
  high: "bg-indigo-500",
};

const CATEGORY_STYLES = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-800",
  moderate: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};

function shortDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function categoryLabel(category) {
  if (!category) return "Not assessed";
  return category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function MetricCard({ label, value, hint, tone }) {
  return (
    <div className={`${CARD_CLASS} p-5`}>
      <p className="text-sm font-medium text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
      <span className={`mt-3 inline-block size-2 rounded-full ${METRIC_DOT[tone]}`} aria-hidden="true" />
    </div>
  );
}

export default function FieldOfficerDashboard() {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // Every figure on this page comes from the server's registered-student rule, so a pending or
    // confirmed duplicate can never appear in a count, the attention list or recent registrations.
    api.get("/students/registered/overview")
      .then((response) => setOverview(response.data))
      .catch((requestError) => setError(requestError.response?.data?.message || "Unable to load your dashboard."))
      .finally(() => setLoading(false));
  }, []);

  const metrics = overview?.metrics || {
    registered_students: 0,
    needs_attention: 0,
    high_eligibility: 0,
    breakdown: { high: 0, moderate: 0, low: 0 },
  };
  const attention = overview?.needs_attention || [];
  const recent = overview?.recent_registrations || [];

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-2 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">Field Officer dashboard</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            Welcome, {user?.full_name?.split(" ")[0] || "Field Officer"}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Cleared and assessed guardian registrations.
          </p>
        </div>
        <Link
          to="/students"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
        >
          <Users size={16} aria-hidden="true" />
          View registered students
        </Link>
      </header>

      {error && <p className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <section aria-label="Overview metrics" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Registered students" value={metrics.registered_students} hint="Cleared and assessed" tone="registered" />
        <MetricCard label="Needs attention" value={metrics.needs_attention} hint="Assessment incomplete" tone="attention" />
        <MetricCard label="High eligibility" value={metrics.high_eligibility} hint="High need category" tone="high" />
      </section>

      <section aria-label="Eligibility breakdown" className={`${CARD_CLASS} mt-4 p-5`}>
        <h2 className="text-sm font-semibold text-slate-900">Eligibility breakdown</h2>
        {loading ? (
          <p className="mt-2 text-sm text-slate-500">Loading breakdown...</p>
        ) : (
          <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {["high", "moderate", "low"].map((category) => (
              <div key={category} className={`rounded-lg border px-4 py-3 ${CATEGORY_STYLES[category]}`}>
                <dt className="text-xs font-semibold uppercase tracking-wide">{categoryLabel(category)}</dt>
                <dd className="mt-1 text-2xl font-semibold">{metrics.breakdown?.[category] ?? 0}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Needs your attention" className={CARD_CLASS}>
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Needs your attention</h2>
              <p className="mt-1 text-sm text-slate-600">Cleared students whose assessment still needs information.</p>
            </div>
            <ClipboardList className="size-5 text-amber-600" aria-hidden="true" />
          </div>
          {loading ? (
            <p className="px-5 py-6 text-sm text-slate-500">Loading attention list...</p>
          ) : attention.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-sm font-medium text-slate-900">Nothing needs attention</p>
              <p className="mt-1 text-sm text-slate-600">Every cleared student has a completed eligibility assessment.</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {attention.map((student) => (
                <li key={student.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">{student.full_name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {student.school || "School not recorded"} - Registered {shortDate(student.created_at)}
                    </p>
                    <p className="mt-1 text-xs text-amber-700">{student.reason}</p>
                  </div>
                  <Link
                    to={`/eligibility?student=${student.id}`}
                    className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-700 transition hover:bg-blue-50"
                  >
                    Review eligibility
                    <ArrowRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Quick actions" className={CARD_CLASS}>
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-lg font-semibold text-slate-900">Quick actions</h2>
            <p className="mt-1 text-sm text-slate-600">Only actions your role can use.</p>
          </div>
          <ul className="divide-y divide-slate-100">
            <li>
              <Link to="/students" className="flex items-center justify-between px-5 py-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
                <span className="flex items-center gap-2"><Users size={16} aria-hidden="true" /> View registered students</span>
                <ArrowRight size={15} className="text-slate-400" aria-hidden="true" />
              </Link>
            </li>
            <li>
              <Link to="/eligibility" className="flex items-center justify-between px-5 py-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
                <span className="flex items-center gap-2"><BadgeCheck size={16} aria-hidden="true" /> Review eligibility</span>
                <ArrowRight size={15} className="text-slate-400" aria-hidden="true" />
              </Link>
            </li>
            <li>
              <Link to="/awards" className="flex items-center justify-between px-5 py-4 text-sm font-medium text-slate-800 hover:bg-slate-50">
                <span className="flex items-center gap-2"><ClipboardList size={16} aria-hidden="true" /> Bursary awards</span>
                <ArrowRight size={15} className="text-slate-400" aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </section>
      </div>

      <section aria-label="Recent registrations" className={`${CARD_CLASS} mt-6`}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Recent registrations</h2>
            <p className="mt-1 text-sm text-slate-600">Latest cleared registrations.</p>
          </div>
          <BadgeCheck className="size-5 text-emerald-600" aria-hidden="true" />
        </div>
        {loading ? (
          <p className="px-5 py-6 text-sm text-slate-500">Loading registrations...</p>
        ) : recent.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-medium text-slate-900">No assessed registrations yet</p>
            <p className="mt-1 text-sm text-slate-600">They appear here after duplicate clearance and eligibility assessment.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Student</th>
                  <th className="px-5 py-3 font-medium">School</th>
                  <th className="px-5 py-3 font-medium">Registered</th>
                  <th className="px-5 py-3 font-medium">Eligibility</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recent.map((student) => (
                  <tr key={student.id} className="text-slate-700">
                    <td className="px-5 py-3 font-medium text-slate-900">{student.full_name}</td>
                    <td className="px-5 py-3">{student.school || "-"}</td>
                    <td className="px-5 py-3">{shortDate(student.created_at)}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${CATEGORY_STYLES[student.category] || CATEGORY_STYLES.low}`}>
                        {categoryLabel(student.category)}
                        {student.score != null && <span className="text-slate-500">({student.score})</span>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

