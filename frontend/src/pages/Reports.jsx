import { useState } from "react";
import api from "../services/api";

export default function Reports() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleExport(event) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await api.get("/reports/export", {
        params: { start_date: startDate, end_date: endDate },
        responseType: "blob",
      });
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `sbms-report-${startDate}-to-${endDate}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err.response?.data instanceof Blob) {
        const message = await err.response.data.text();
        try {
          setError(JSON.parse(message).message || "Failed to export report.");
        } catch {
          setError("Failed to export report.");
        }
      } else {
        setError(err.response?.data?.message || "Failed to export report.");
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Reports</h1>
      <p className="text-gray-600 mb-6">Export a disbursement and beneficiary report for a selected period.</p>

      {error && <div className="mb-5 p-4 bg-red-100 text-red-700 rounded">{error}</div>}

      <form onSubmit={handleExport} className="bg-white p-6 rounded-lg shadow">
        <label className="block font-medium mb-2">Start date</label>
        <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="w-full border rounded p-3 mb-5" required />

        <label className="block font-medium mb-2">End date</label>
        <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="w-full border rounded p-3 mb-6" required />

        <button type="submit" disabled={loading} className="bg-blue-600 text-white px-5 py-3 rounded hover:bg-blue-700 disabled:opacity-50">
          {loading ? "Generating PDF..." : "Export PDF"}
        </button>
      </form>
    </div>
  );
}
