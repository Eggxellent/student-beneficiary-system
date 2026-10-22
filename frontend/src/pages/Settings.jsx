import { useEffect, useState } from "react";
import api from "../services/api";

export default function Settings() {
  const [threshold, setThreshold] = useState(50);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/settings/threshold")
      .then((response) => {
        setThreshold(Math.round(Number(response.data.mlReviewThreshold) * 100));
      })
      .catch((requestError) => setError(requestError.response?.data?.message || "Unable to load settings."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");

    try {
      const response = await api.put("/settings/threshold", {
        mlReviewThreshold: Number(threshold) / 100,
      });
      setMessage(response.data.message);
    } catch (requestError) {
      setError(requestError.response?.data?.message || "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <p className="text-sm font-medium text-blue-600">Administration</p>
      <h1 className="mt-1 text-2xl font-bold text-slate-900">Duplicate Detection Settings</h1>
      <p className="mt-1 text-sm text-slate-500">Set the provisional XGBoost score cutoff for creating a human review case. The score is not calibrated and never decides a student's eligibility.</p>

      <form onSubmit={handleSubmit} className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <label className="block text-sm font-medium text-slate-800">Model review cutoff: {threshold}%</label>
        <input
          type="range"
          min="0"
          max="100"
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
          className="mt-3 w-full accent-blue-600"
          disabled={loading}
        />
        <p className="mt-2 text-xs text-slate-500">Pairs at or above this score are sent to an Admin for review. Exact National ID matches are also sent for review as a separate deterministic signal.</p>
        <p className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">The model has only synthetic evaluation data; its holdout influenced model selection. This cutoff is provisional, not empirically validated, and changes apply in memory until the API restarts. Configure the startup value with <code>ML_REVIEW_SCORE_THRESHOLD</code>.</p>

        {error && <p className="mt-5 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {message && <p className="mt-5 rounded bg-green-50 p-3 text-sm text-green-700">{message}</p>}

        <button type="submit" disabled={loading || saving} className="mt-6 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Saving..." : "Save Settings"}
        </button>
      </form>
    </main>
  );
}
