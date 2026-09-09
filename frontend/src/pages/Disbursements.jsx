import { useEffect, useState } from "react";
import api from "../services/api";

function rows(data) {
  return Array.isArray(data) ? data : data?.value || [];
}

export default function Disbursements() {
  const [students, setStudents] = useState([]);
  const [disbursements, setDisbursements] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  function loadData() {
    setLoading(true);
    Promise.all([api.get("/students"), api.get("/disbursements")])
      .then(([studentResponse, disbursementResponse]) => {
        setStudents(rows(studentResponse.data));
        setDisbursements(rows(disbursementResponse.data));
      })
      .catch((err) => setError(err.response?.data?.message || "Failed to load disbursements."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    setMessage("");

    try {
      await api.post("/disbursements", {
        student_id: studentId,
        amount: Number(amount),
      });
      setStudentId("");
      setAmount("");
      setMessage("Disbursement created successfully.");
      loadData();
    } catch (err) {
      setError(err.response?.data?.message || "Failed to create disbursement.");
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Disbursements</h1>
      <p className="text-gray-600 mb-6">Create and review student disbursements.</p>

      {error && <div className="mb-5 p-4 bg-red-100 text-red-700 rounded">{error}</div>}
      {message && <div className="mb-5 p-4 bg-green-100 text-green-700 rounded">{message}</div>}

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg shadow mb-8">
        <label className="block font-medium mb-2">Student</label>
        <select value={studentId} onChange={(event) => setStudentId(event.target.value)} className="w-full border rounded p-3 mb-5" required>
          <option value="">Select a student</option>
          {students.map((student) => (
            <option key={student.id} value={student.id}>{student.full_name}</option>
          ))}
        </select>

        <label className="block font-medium mb-2">Amount</label>
        <input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} className="w-full border rounded p-3 mb-5" placeholder="15000" required />
        <button type="submit" className="bg-blue-600 text-white px-5 py-3 rounded">Create Disbursement</button>
      </form>

      <section className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full">
          <thead><tr className="border-b text-left"><th className="p-4">Student</th><th className="p-4">Amount</th><th className="p-4">Date</th><th className="p-4">Status</th></tr></thead>
          <tbody>
            {!loading && disbursements.length === 0 && <tr><td className="p-4" colSpan="4">No disbursements found.</td></tr>}
            {disbursements.map((disbursement) => (
              <tr key={disbursement.id} className="border-b"><td className="p-4">{disbursement.student_name}</td><td className="p-4">KSh {Number(disbursement.amount).toLocaleString()}</td><td className="p-4">{disbursement.disbursement_date}</td><td className="p-4">{disbursement.status}</td></tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
