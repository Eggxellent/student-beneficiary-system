import { useEffect, useState } from "react";
import api from "../services/api";

export default function DuplicateReview() {
  const [flags, setFlags] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  function fetchFlags() {
    setLoading(true);
    api.get("/duplicate-flags?status=pending")
      .then((response) => setFlags(response.data))
      .catch((err) => setError(err.response?.data?.message || "Failed to load duplicate flags."))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    fetchFlags();
  }, []);

  function resolveFlag(id, status) {
    setError("");
    api.patch(`/duplicate-flags/${id}`, { status })
      .then(() => fetchFlags())
      .catch((err) => setError(err.response?.data?.message || "Failed to update duplicate flag."));
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-2">Duplicate Review</h1>
      <p className="text-gray-600 mb-6">Review pending duplicate matches before disbursement.</p>

      {error && <p className="error">{error}</p>}
      {loading && <p>Loading duplicate flags...</p>}
      {!loading && flags.length === 0 && <p>No pending duplicate flags.</p>}

      {!loading && flags.length > 0 && (
        <div className="overflow-x-auto">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Matched Student</th>
                <th>Probability</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {flags.map((flag) => (
                <tr key={flag.id}>
                  <td>{flag.student_name}</td>
                  <td>{flag.matched_student_name}</td>
                  <td>{(Number(flag.probability) * 100).toFixed(1)}%</td>
                  <td>
                    <button onClick={() => resolveFlag(flag.id, "confirmed_duplicate")}>
                      Confirm Duplicate
                    </button>{" "}
                    <button onClick={() => resolveFlag(flag.id, "cleared")}>
                      Clear
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
