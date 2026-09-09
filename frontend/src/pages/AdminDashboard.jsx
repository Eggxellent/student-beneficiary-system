import { useEffect, useState } from "react";
import {
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import { Bar, Line } from "react-chartjs-2";
import api from "../services/api";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

function rows(data) {
  return Array.isArray(data) ? data : data?.value || [];
}

export default function AdminDashboard() {
  const [students, setStudents] = useState([]);
  const [disbursements, setDisbursements] = useState([]);
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadDashboard() {
    try {
      setLoading(true);
      const [studentsResponse, disbursementsResponse, flagsResponse] = await Promise.all([
        api.get("/students"),
        api.get("/disbursements"),
        api.get("/duplicate-flags?status=pending"),
      ]);

      setStudents(rows(studentsResponse.data));
      setDisbursements(rows(disbursementsResponse.data));
      setFlags(rows(flagsResponse.data));
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  if (loading) return <div className="p-8"><p>Loading dashboard...</p></div>;

  const totalDisbursements = disbursements.reduce(
    (total, item) => total + Number(item.amount || 0),
    0
  );
  const schoolCounts = {};
  students.forEach((student) => {
    const school = student.school_code || "Unknown";
    schoolCounts[school] = (schoolCounts[school] || 0) + 1;
  });
  const dateCounts = {};
  disbursements.forEach((item) => {
    const date = item.disbursement_date;
    dateCounts[date] = (dateCounts[date] || 0) + Number(item.amount || 0);
  });

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Admin Dashboard</h1>
      <p className="text-gray-600 mb-8">Student Beneficiary Management System overview</p>
      {error && <div className="mb-6 p-4 bg-red-100 text-red-700 rounded">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow"><p className="text-gray-500">Total Students</p><p className="text-3xl font-bold mt-2">{students.length}</p></div>
        <div className="bg-white p-6 rounded-lg shadow"><p className="text-gray-500">Total Disbursements</p><p className="text-3xl font-bold mt-2">KSh {totalDisbursements.toLocaleString()}</p></div>
        <div className="bg-white p-6 rounded-lg shadow"><p className="text-gray-500">Pending Duplicate Flags</p><p className="text-3xl font-bold mt-2">{flags.length}</p></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-5">Disbursements Over Time</h2>
          <Line data={{ labels: Object.keys(dateCounts), datasets: [{ label: "Disbursements (KSh)", data: Object.values(dateCounts) }] }} options={{ responsive: true }} />
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-5">Students by School</h2>
          <Bar data={{ labels: Object.keys(schoolCounts), datasets: [{ label: "Students", data: Object.values(schoolCounts) }] }} options={{ responsive: true }} />
        </div>
      </div>
    </div>
  );
}
