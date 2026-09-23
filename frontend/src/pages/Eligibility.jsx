import { useEffect, useState } from "react";
import api from "../services/api";

export default function Eligibility() {
  const [form, setForm] = useState({
    student_id: "",
    fee_balance: "",
    household_income: "",
    vulnerability_status: "low",
    siblings_in_school: 0,
    prior_bursary_history: "none",
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [students, setStudents] = useState([]);

  useEffect(() => {
    api.get("/students")
      .then((response) => setStudents(Array.isArray(response.data) ? response.data : response.data?.value || []))
      .catch(() => setStudents([]));
  }, []);

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/eligibility", {
        student_id: form.student_id || undefined,
        fee_balance: Number(form.fee_balance),
        household_income: Number(form.household_income),
        vulnerability_status: form.vulnerability_status,
        siblings_in_school: Number(form.siblings_in_school),
        prior_bursary_history: form.prior_bursary_history,
      });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to calculate eligibility. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Eligibility Assessment</h1>
      <p className="text-gray-600 mb-6">Calculate a student's bursary eligibility score.</p>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow">
        <label className="block font-medium mb-2">Student (optional)</label>
        <select name="student_id" value={form.student_id} onChange={handleChange} className="w-full border rounded p-3 mb-5">
          <option value="">Calculate without saving an assessment</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.full_name} - {student.upi}</option>
          ))}
        </select>

        <label className="block font-medium mb-2">Fee Balance (KSh)</label>
        <input type="number" min="0" name="fee_balance" value={form.fee_balance} onChange={handleChange} className="w-full border rounded p-3 mb-5" required />

        <label className="block font-medium mb-2">Household Income (KSh)</label>
        <input type="number" min="0" name="household_income" value={form.household_income} onChange={handleChange} className="w-full border rounded p-3 mb-5" required />

        <label className="block font-medium mb-2">Vulnerability Status</label>
        <select name="vulnerability_status" value={form.vulnerability_status} onChange={handleChange} className="w-full border rounded p-3 mb-5">
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>

        <label className="block font-medium mb-2">Siblings Currently in School</label>
        <input type="number" min="0" name="siblings_in_school" value={form.siblings_in_school} onChange={handleChange} className="w-full border rounded p-3 mb-5" required />

        <label className="block font-medium mb-2">Prior Bursary History</label>
        <select name="prior_bursary_history" value={form.prior_bursary_history} onChange={handleChange} className="w-full border rounded p-3 mb-6">
          <option value="none">None</option>
          <option value="low">Low</option>
          <option value="high">High</option>
        </select>

        <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded hover:bg-blue-700 disabled:opacity-50">{loading ? "Calculating..." : "Calculate Eligibility"}</button>
      </form>

      {error && <div className="mt-6 bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">{error}</div>}

      {result && (
        <div className="mt-6 bg-white p-6 rounded-lg shadow text-center">
          <p className="text-gray-600">Eligibility Score</p>
          <p className="text-5xl font-bold my-3">{result.score}/100</p>
          <p className="text-xl font-semibold">
            {result.category.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase())}
          </p>
          <div className="mt-5 text-left border-t pt-4">
            <p className="font-semibold mb-2">Assessment reasons</p>
            {result.reasons.map((reason, index) => (
              <div key={reason} className="flex justify-between gap-4 py-1 text-sm">
                <span>{reason}</span>
                <span className="font-medium">+{Object.values(result.breakdown)[index]}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-xs text-gray-500">This score supports review and does not replace authorized approval.</p>
        </div>
      )}
    </div>
  );
}
