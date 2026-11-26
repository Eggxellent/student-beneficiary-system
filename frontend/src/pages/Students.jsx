import { useEffect, useState } from "react";
import api from "../services/api";

const CATEGORY_STYLES = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-800",
  moderate: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};

function categoryLabel(category) {
  if (!category) return "Not assessed";
  return category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function money(value, currency) {
  if (value === null || value === undefined || value === "") return null;
  return `${currency || "KSh"} ${Number(value).toLocaleString("en-KE")}`;
}

function shortDate(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function recommendedRange(student) {
  const min = money(student.recommended_min, student.recommended_currency);
  const max = money(student.recommended_max, student.recommended_currency);
  if (!min && !max) return "Not recorded";
  if (!min || !max) return min || max;
  return `${min} - ${max}`;
}

export default function Students() {
  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    // The server returns only duplicate-cleared, assessed guardian registrations; this table
    // deliberately performs no eligibility or duplicate filtering of its own.
    api.get("/students/registered")
      .then((response) => setStudents(Array.isArray(response.data) ? response.data : response.data?.value || []))
      .catch((requestError) => setError(requestError.response?.data?.message || "Unable to load registered students."))
      .finally(() => setLoading(false));
  }, []);

  const filteredStudents = students.filter((student) => {
    const searchable = [
      student.full_name,
      student.admission_number,
      student.guardian_id,
      student.school_code,
      student.birth_certificate_number,
      student.national_id_number,
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(query.toLowerCase());
  });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Registered students</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Only duplicate-cleared guardian registrations with completed assessments appear here.
          </p>
        </div>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, admission number, guardian, school, or birth certificate"
        className="mb-5 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />

      {error && <p className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <section aria-label="Registered students" className="space-y-3">
        {filteredStudents.map((student) => (
          <article key={student.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold text-slate-900">{student.full_name}</h2>
                <p className="mt-1 text-sm text-slate-600">{student.school_code || "School not recorded"}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2 self-start">
                <span className="text-lg font-bold tabular-nums text-slate-900">{student.score} / 100</span>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${CATEGORY_STYLES[student.category] || CATEGORY_STYLES.low}`}>
                  {categoryLabel(student.category)}
                </span>
              </div>
            </div>

            <dl className="mt-4 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div className="min-w-0">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Admission number</dt>
                <dd className="mt-0.5 break-all font-medium text-slate-800">{student.admission_number || "Not captured"}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Recommended range</dt>
                <dd className="mt-0.5 font-medium text-slate-800">{recommendedRange(student)}</dd>
                {student.recommendation_provisional && (
                  <dd className="text-xs text-slate-500">Provisional recommendation</dd>
                )}
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Registration</dt>
                <dd className="mt-0.5 text-slate-800">{shortDate(student.created_at)} · duplicate check cleared</dd>
              </div>
            </dl>

            <details className="mt-4 border-t border-slate-100 pt-3 text-sm">
              <summary className="w-fit cursor-pointer font-medium text-blue-700 hover:text-blue-800">
                More student details
              </summary>
              <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Date of birth</dt>
                  <dd className="mt-0.5 text-slate-800">{shortDate(student.date_of_birth)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Birth certificate</dt>
                  <dd className="mt-0.5 break-all text-slate-800">{student.birth_certificate_number || "Not captured"}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Guardian reference</dt>
                  <dd className="mt-0.5 break-all text-slate-800">{student.guardian_id || "Not recorded"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Assessment</dt>
                  <dd className="mt-0.5 text-slate-800">Assessed {shortDate(student.assessed_at)}</dd>
                </div>
              </dl>
            </details>
          </article>
        ))}
        {!loading && filteredStudents.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center text-slate-500">
            No students to show. A guardian registration appears here once duplicate screening is cleared and an eligibility assessment is saved.
          </p>
        )}
        {loading && (
          <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-slate-500">
            Loading students...
          </p>
        )}
      </section>
    </main>
  );
}
