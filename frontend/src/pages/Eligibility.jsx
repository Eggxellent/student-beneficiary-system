import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const EMPTY_FORM = {
  student_id: "",
  fee_balance: "",
  household_income: "",
  vulnerability_status: "low",
  siblings_in_school: "",
  prior_bursary_history: "none",
};

const CATEGORY_STYLES = {
  high: "border-emerald-200 bg-emerald-50 text-emerald-800",
  moderate: "border-amber-200 bg-amber-50 text-amber-800",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};

const FALLBACK_FORMULA = [
  { key: "fee_balance", label: "Fee balance", max_points: 30, rules: [">= 50,000: 30", ">= 30,000: 25", ">= 15,000: 15", "> 0: 5", "0: 0"] },
  { key: "household_income", label: "Household income", max_points: 25, rules: ["<= 20,000: 25", "<= 40,000: 20", "<= 60,000: 10", "above 60,000: 0"] },
  { key: "vulnerability_status", label: "Vulnerability status", max_points: 25, rules: ["High: 25", "Medium: 15", "Low: 5"] },
  { key: "siblings_in_school", label: "Siblings in school", max_points: 10, rules: [">= 4: 10", "2-3: 7", "1: 3", "0: 0"] },
  { key: "prior_bursary_history", label: "Prior bursary history", max_points: 10, rules: ["None: 10", "Low: 7", "High: 2"] },
];

const money = (value) => `KSh ${Number(value).toLocaleString("en-KE")}`;

const fieldClass =
  "mt-2 h-11 w-full border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400";
const labelClass = "block text-[10px] font-bold uppercase tracking-wide text-slate-800";

export default function Eligibility() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [form, setForm] = useState(EMPTY_FORM);
  const [students, setStudents] = useState([]);
  const [formula, setFormula] = useState({ factors: FALLBACK_FORMULA });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.get("/students")
      .then((response) => setStudents(Array.isArray(response.data) ? response.data : response.data?.value || []))
      .catch(() => setStudents([]));
    if (isAdmin) {
      api.get("/eligibility")
        .then((response) => setFormula(response.data || { factors: FALLBACK_FORMULA }))
        .catch(() => setFormula({ factors: FALLBACK_FORMULA }));
    }
  }, [isAdmin]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.id === form.student_id) || null,
    [students, form.student_id]
  );

  const hasStudent = Boolean(form.student_id);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    setResult(null);
    setError("");
  }

  function resetStudent() {
    setForm(EMPTY_FORM);
    setResult(null);
    setError("");
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!hasStudent) {
      setError("Select a registered student before calculating eligibility.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/eligibility", {
        student_id: form.student_id,
        fee_balance: Number(form.fee_balance),
        household_income: Number(form.household_income),
        vulnerability_status: form.vulnerability_status,
        siblings_in_school: Number(form.siblings_in_school || 0),
        prior_bursary_history: form.prior_bursary_history,
      });
      setResult(response.data);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to calculate eligibility. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  const provisional = result?.recommended_range?.provisional ?? formula.amount_ranges_provisional ?? true;

  return (
    <main className="space-y-5 p-6">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Eligibility calculation</h1>
        <p className="mt-1 text-sm text-slate-600">
          Financial-need assessment for a registered student. The result guides the approving officer; it never approves a bursary on its own.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">1. Select student</h2>
            {hasStudent && (
              <button type="button" onClick={resetStudent} className="text-xs font-semibold text-sky-600 hover:underline">Clear</button>
            )}
          </div>

          <div className="p-4">
            <label className={labelClass}>
              Registered student <span className="text-red-600">*</span>
              <select
                name="student_id"
                value={form.student_id}
                onChange={handleChange}
                required
                aria-invalid={!hasStudent}
                className={fieldClass}
              >
                <option value="">Select a registered student (required)</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name}
                    {student.upi ? ` - ${student.upi}` : ""}
                    {student.school_code ? ` - ${student.school_code}` : ""}
                  </option>
                ))}
              </select>
            </label>

            {selectedStudent && (
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <dt className="font-semibold text-slate-500">UPI</dt>
                <dd className="text-right text-slate-800">{selectedStudent.upi || "Not recorded"}</dd>
                <dt className="font-semibold text-slate-500">School</dt>
                <dd className="text-right text-slate-800">{selectedStudent.school_code || "Not recorded"}</dd>
                <dt className="font-semibold text-slate-500">Last category</dt>
                <dd className="text-right capitalize text-slate-800">{selectedStudent.eligibility_category || "Not assessed"}</dd>
              </dl>
            )}

            {!hasStudent && (
              <p className="mt-3 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                A student must be selected before the assessment fields are enabled. The result is saved to that student's record.
              </p>
            )}
          </div>
        </section>

        {isAdmin && (
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Scoring formula</h2>
            <p className="mt-1 text-xs text-slate-500">
              {formula.scale || "Score out of 100 - five weighted factors"}. Fixed, documented weights.
            </p>
          </div>
          <div className="p-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="pb-1">Factor</th>
                  <th className="pb-1">Max</th>
                  <th className="pb-1">Rule</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(formula.factors || FALLBACK_FORMULA).map((factor) => (
                  <tr key={factor.key}>
                    <td className="py-1.5 pr-2 font-semibold text-slate-800">{factor.label}</td>
                    <td className="py-1.5 pr-2 text-slate-600">{factor.max_points}</td>
                    <td className="py-1.5 text-slate-500">{factor.rules.join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate-600">
              Bands: <span className="font-semibold">High</span> 70-100 · <span className="font-semibold">Moderate</span> 40-69 · <span className="font-semibold">Low</span> 0-39
            </p>
            {provisional && (
              <p className="mt-2 border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">
                Bursary amount ranges are provisional: no approved allocation ranges are configured.
              </p>
            )}
          </div>
        </section>
        )}
      </div>

      <form onSubmit={handleSubmit} className="border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">2. Assessment details</h2>
        </div>
        <fieldset disabled={!hasStudent || loading} className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <label className={labelClass}>Fee balance (KSh)
            <input type="number" min="0" name="fee_balance" value={form.fee_balance} onChange={handleChange} className={fieldClass} placeholder="45000" required />
          </label>
          <label className={labelClass}>Household income (KSh)
            <input type="number" min="0" name="household_income" value={form.household_income} onChange={handleChange} className={fieldClass} placeholder="18000" required />
          </label>
          <label className={labelClass}>Vulnerability
            <select name="vulnerability_status" value={form.vulnerability_status} onChange={handleChange} className={fieldClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className={labelClass}>Siblings in school
            <input type="number" min="0" name="siblings_in_school" value={form.siblings_in_school} onChange={handleChange} className={fieldClass} placeholder="2" required />
          </label>
          <label className={labelClass}>Prior bursary
            <select name="prior_bursary_history" value={form.prior_bursary_history} onChange={handleChange} className={fieldClass}>
              <option value="none">None</option>
              <option value="low">Low</option>
              <option value="high">High</option>
            </select>
          </label>
        </fieldset>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <p className="text-xs text-slate-500">
            {hasStudent
              ? `Result will be saved to ${selectedStudent?.full_name || "the selected student"}.`
              : "Select a student to enable calculation."}
          </p>
          <button
            type="submit"
            disabled={!hasStudent || loading}
            title={!hasStudent ? "Select a registered student first" : undefined}
            className="h-10 bg-sky-500 px-6 text-sm font-bold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Calculating..." : "Calculate"}
          </button>
        </div>
      </form>

      {error && (
        <div className="border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">{error}</div>
      )}

      {result && (
        <section className="border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Result</h2>
            <p className="mt-1 text-xs text-slate-500">
              {result.student?.full_name}
              {result.student?.upi ? ` · ${result.student.upi}` : ""}
              {result.student?.school_code ? ` · ${result.student.school_code}` : ""} — saved to this student's record.
            </p>
          </div>

          <div className="grid gap-4 p-4 sm:grid-cols-3">
            <div className={`border p-4 ${CATEGORY_STYLES[result.category] || CATEGORY_STYLES.low}`}>
              <p className="text-[10px] font-bold uppercase tracking-wide">Eligibility category</p>
              <p className="mt-1 text-2xl font-bold">{result.category_label}</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-4 text-slate-800">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Eligibility score</p>
              <p className="mt-1 text-2xl font-bold">{result.score} / {result.max_score ?? 100}</p>
            </div>
            <div className="border border-sky-200 bg-sky-50 p-4 text-sky-900">
              <p className="text-[10px] font-bold uppercase tracking-wide text-sky-700">Recommended bursary range</p>
              <p className="mt-1 text-2xl font-bold">{money(result.recommended_range.min)} – {money(result.recommended_range.max)}</p>
              {result.recommended_range.provisional && (
                <p className="mt-1 inline-block bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">Provisional</p>
              )}
            </div>
          </div>

          {result.recommended_range.provisional && (
            <p className="mx-4 mb-4 border-l-2 border-amber-400 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No approved allocation ranges are configured, so these figures are a provisional proposal - not an official NG-CDF allocation limit. The authorised officer sets the final amount.
            </p>
          )}

          <div className="border-t border-slate-200 px-4 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Score breakdown</p>
            <table className="mt-2 w-full text-xs">
              <tbody className="divide-y divide-slate-100">
                {(result.factors || []).map((factor) => (
                  <tr key={factor.key}>
                    <td className="py-1.5 pr-3 font-semibold text-slate-800">{factor.label}</td>
                    <td className="py-1.5 pr-3 text-slate-500">{factor.detail}</td>
                    <td className="py-1.5 text-right font-bold text-slate-800">{factor.points} / {factor.max_points}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200">
                  <td className="py-2 font-bold text-slate-900" colSpan={2}>Total</td>
                  <td className="py-2 text-right font-bold text-slate-900">{result.score} / {result.max_score ?? 100}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="border-t border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
            {result.guidance || "Recommendation only. An authorised officer must approve or reject the bursary."}
          </p>
        </section>
      )}
    </main>
  );
}
