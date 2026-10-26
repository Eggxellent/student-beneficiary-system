import { useEffect, useState } from "react";
import api from "../services/api";

function formatDate(value) {
  return new Date(value).toLocaleString();
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/audit-logs")
      .then((response) => {
        setError("");
        setLogs(Array.isArray(response.data) ? response.data : response.data?.value || []);
      })
      .catch((requestError) => setError(requestError.response?.data?.message || "Unable to load audit logs."))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="mx-auto max-w-7xl p-6">
      <h1 className="text-2xl font-bold text-slate-900">Audit Logs</h1>

      {error && <p className="mt-5 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Time</th>
              <th className="px-5 py-3 font-medium">User</th>
              <th className="px-5 py-3 font-medium">Action</th>
              <th className="px-5 py-3 font-medium">Resource</th>
              <th className="px-5 py-3 font-medium">Record</th>
              <th className="px-5 py-3 font-medium">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {logs.map((log) => (
              <tr key={log.id} className="text-slate-700">
                <td className="whitespace-nowrap px-5 py-4">{formatDate(log.created_at)}</td>
                <td className="px-5 py-4">
                  <p className="font-medium text-slate-900">{log.user_name || "System"}</p>
                  <p className="text-xs text-slate-500">{log.user_email || "-"}</p>
                </td>
                <td className="px-5 py-4 font-medium text-slate-900">{log.action.replaceAll("_", " ")}</td>
                <td className="px-5 py-4">{log.table_name || "-"}</td>
                <td className="px-5 py-4 font-mono text-xs">{log.record_id || "-"}</td>
                <td className="max-w-xs px-5 py-4 text-xs text-slate-600">{log.details ? JSON.stringify(log.details) : "-"}</td>
              </tr>
            ))}
            {!loading && logs.length === 0 && (
              <tr><td colSpan="6" className="px-5 py-10 text-center text-slate-500">No audit events.</td></tr>
            )}
            {loading && <tr><td colSpan="6" className="px-5 py-10 text-center text-slate-500">Loading audit logs...</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
