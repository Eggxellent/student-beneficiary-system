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
      student.upi,
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
            Guardian registrations that duplicate screening has cleared and that carry a saved eligibility assessment.
            Pending or confirmed duplicate cases and unassessed records are withheld until they are resolved.
          </p>
        </div>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, unique ID, guardian, school, or birth certificate"
        className="mb-5 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />

      {error && <p className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Student</th>
              <th className="px-5 py-3 font-medium">Unique ID</th>
              <th className="px-5 py-3 font-medium">School</th>
              <th className="px-5 py-3 font-medium">Registration</th>
              <th className="px-5 py-3 font-medium">Eligibility</th>
              <th className="px-5 py-3 font-medium">Recommended range</th>
              <th className="px-5 py-3 font-medium">Assessment status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredStudents.map((student) => (
              <tr key={student.id} className="align-top text-slate-700">
                <td className="px-5 py-4">
                  <p className="font-medium text-slate-900">{student.full_name}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    {student.date_of_birth ? `Date of birth ${shortDate(student.date_of_birth)}` : "Date of birth not captured"}
                  </p>
                </td>
                <td className="px-5 py-4">
                  <p>{student.upi || "Not captured"}</p>
                  {student.birth_certificate_number && (
                    <p className="mt-1 text-xs text-slate-500">Birth certificate {student.birth_certificate_number}</p>
                  )}
                </td>
                <td className="px-5 py-4">{student.school_code || "-"}</td>
                <td className="px-5 py-4">
                  <p>Guardian {student.guardian_id}</p>
                  <p className="mt-1 text-xs text-slate-500">Registered {shortDate(student.created_at)}</p>
                  <p className="text-xs text-slate-500">Duplicate screening cleared</p>
                </td>
                <td className="px-5 py-4">
                  <p className="font-semibold text-slate-900">{student.score} / 100</p>
                  <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${CATEGORY_STYLES[student.category] || CATEGORY_STYLES.low}`}>
                    {categoryLabel(student.category)}
                  </span>
                </td>
                <td className="px-5 py-4">
                  <p>{recommendedRange(student)}</p>
                  {student.recommendation_provisional && (
                    <p className="mt-1 text-xs text-slate-500">Provisional recommendation</p>
                  )}
                </td>
                <td className="px-5 py-4">
                  <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
                    Assessed
                  </span>
                  <p className="mt-1 text-xs text-slate-500">{shortDate(student.assessed_at)}</p>
                </td>
              </tr>
            ))}
            {!loading && filteredStudents.length === 0 && (
              <tr>
                <td colSpan="7" className="px-5 py-10 text-center text-slate-500">
                  No students to show. A guardian registration appears here once duplicate screening is cleared and an eligibility assessment is saved.
                </td>
              </tr>
            )}
            {loading && <tr><td colSpan="7" className="px-5 py-10 text-center text-slate-500">Loading students...</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
