import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";

function eligibilityLabel(category) {
  if (!category) return "Not assessed";
  return category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function Students() {
  const [students, setStudents] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/students")
      .then((response) => setStudents(Array.isArray(response.data) ? response.data : response.data?.value || []))
      .catch((requestError) => setError(requestError.response?.data?.message || "Unable to load students."))
      .finally(() => setLoading(false));
  }, []);

  const filteredStudents = students.filter((student) => {
    const searchable = `${student.full_name} ${student.upi} ${student.school_code || ""} ${student.birth_certificate_number || ""}`.toLowerCase();
    return searchable.includes(query.toLowerCase());
  });

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Students</h1>
        </div>
        <Link to="/students/register" className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
          Register Student
        </Link>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search name, UPI, school, or birth certificate"
        className="mb-5 w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />

      {error && <p className="mb-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Student</th>
              <th className="px-5 py-3 font-medium">UPI</th>
              <th className="px-5 py-3 font-medium">School</th>
              <th className="px-5 py-3 font-medium">Birth Certificate</th>
              <th className="px-5 py-3 font-medium">Eligibility</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredStudents.map((student) => (
              <tr key={student.id} className="text-slate-700">
                <td className="px-5 py-4 font-medium text-slate-900">{student.full_name}</td>
                <td className="px-5 py-4">{student.upi}</td>
                <td className="px-5 py-4">{student.school_code || "-"}</td>
                <td className="px-5 py-4">{student.birth_certificate_number || "-"}</td>
                <td className="px-5 py-4">{eligibilityLabel(student.eligibility_category)}</td>
              </tr>
            ))}
            {!loading && filteredStudents.length === 0 && (
              <tr><td colSpan="5" className="px-5 py-10 text-center text-slate-500">No students found.</td></tr>
            )}
            {loading && <tr><td colSpan="5" className="px-5 py-10 text-center text-slate-500">Loading students...</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
