import { useEffect, useState } from "react";
import { CalendarDays, CreditCard, Phone } from "lucide-react";
import api from "../services/api";

const emptyForm = { first_name: "", last_name: "", date_of_birth: "", school_code: "", national_id_number: "", primary_phone: "" };

function screeningSentence(screening) {
  if (!screening) return "";
  const considered = Number(screening.candidates_considered);
  const qualifying = Number(screening.candidates_qualifying);
  const suppressed = Number(screening.candidates_suppressed);
  if (!Number.isFinite(considered)) return "";
  if (considered === 0) return "No existing students were available to compare against.";
  const parts = [`Checked against ${considered} existing student${considered === 1 ? "" : "s"}`];
  if (Number.isFinite(qualifying) && qualifying > 0) {
    parts.push(`${qualifying} candidate${qualifying === 1 ? "" : "s"} flagged for a second look`);
  }
  if (Number.isFinite(suppressed) && suppressed > 0) {
    parts.push(`${suppressed} further match${suppressed === 1 ? "" : "es"} recorded in the audit log without a separate case`);
  }
  return `${parts.join("; ")}.`;
}

export default function StudentRegistration() {
  const [form, setForm] = useState(emptyForm);
  const [schools, setSchools] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/students/schools").then(({ data }) => setSchools(data)).catch(() => setSchools([]));
  }, []);

  function handleChange(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/students", {
        full_name: `${form.first_name.trim()} ${form.last_name.trim()}`,
        date_of_birth: form.date_of_birth,
        school_code: form.school_code,
        national_id_number: form.national_id_number.trim(),
        primary_phone: form.primary_phone.trim(),
      });
      setResult(response.data);
      setForm(emptyForm);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to register student.");
    } finally {
      setLoading(false);
    }
  }

  // The API publishes `risk_level: 'review'` for every case and never calls a record a
  // duplicate, because both cutoffs are provisional. This screen belongs to a field
  // officer, so it states the outcome in plain language and leaves model version, cutoffs
  // and candidate counts to the administrator's review and audit screens.
  const flags = result?.duplicate_flags || [];
  const screening = result?.duplicate_screening || null;
  const duplicate = flags.length > 0;
  // Exact identifier agreement is evidence a reviewer can check in the source documents,
  // so it earns the stronger warning colour. `risk_level === 'critical'` is kept only as a
  // fallback for responses from an older API build.
  const exactIdentifierMatch = flags.some((flag) => (flag.exact_identifier_matches || []).length > 0)
    || flags.some((flag) => flag.risk_level === "critical");
  const panelClass = exactIdentifierMatch
    ? "border-red-300 bg-red-50 text-red-900"
    : duplicate
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-green-200 bg-green-50 text-green-800";
  const fieldClass = "mt-2 h-11 w-full border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 outline-none focus:border-sky-400 focus:bg-white";
  const labelClass = "block text-[10px] font-bold uppercase tracking-wide text-slate-800";

  return (
    <main className="mx-auto max-w-[560px] px-4 py-8 sm:py-12">
      {result && (
        <section className={`mb-5 border p-4 text-sm ${panelClass}`} role="status">
          <h2 className="font-bold">Student registered</h2>
          <p className="mt-1">{result.message}</p>
          {duplicate && (
            <p className="mt-2">Possible duplicate match found. An administrator must review this case before any disbursement.</p>
          )}
          {flags.filter((flag) => flag.review_reason).map((flag) => (
            <p key={flag.id} className="mt-1">{flag.review_reason}</p>
          ))}
          {screeningSentence(screening) && <p className="mt-2 text-xs">{screeningSentence(screening)}</p>}
          {result.qr_code && <img src={result.qr_code} alt="Student QR code" className="mt-3 h-36 w-36 border bg-white p-2" />}
        </section>
      )}

      <section className="overflow-hidden border border-slate-300 bg-white">
        <header className="border-b border-slate-300 px-5 py-4">
          <h1 className="text-[11px] font-bold tracking-[0.12em] text-slate-800">Register Student</h1>
        </header>
        <form onSubmit={handleSubmit} className="mx-auto max-w-[340px] px-0 py-7 sm:py-8">
          {error && <div className="mb-4 border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</div>}

          <div className="mb-3 grid grid-cols-2 gap-3">
            <label className={labelClass}>First name
              <input name="first_name" value={form.first_name} onChange={handleChange} className={fieldClass} placeholder="First name" required />
            </label>
            <label className={labelClass}>Last name
              <input name="last_name" value={form.last_name} onChange={handleChange} className={fieldClass} placeholder="Last name" required />
            </label>
          </div>

          <label className={`${labelClass} mb-3`}>Date of birth
            <span className="relative block"><CalendarDays size={14} className="pointer-events-none absolute left-2 top-[14px] text-slate-600" aria-hidden="true" /><input type="date" name="date_of_birth" value={form.date_of_birth} onChange={handleChange} className={`${fieldClass} mt-2 pl-8`} required /></span>
          </label>

          <label className={`${labelClass} mb-3`}>Select school
            <select name="school_code" value={form.school_code} onChange={handleChange} className={fieldClass} required>
              <option value="" disabled>Choose school...</option>
              {schools.map((school) => <option key={school} value={school}>{school}</option>)}
            </select>
          </label>

          <label className={`${labelClass} mb-3`}>National ID number
            <span className="relative block"><CreditCard size={14} className="pointer-events-none absolute left-2 top-[14px] text-slate-600" aria-hidden="true" /><input name="national_id_number" value={form.national_id_number} onChange={handleChange} className={`${fieldClass} pl-8`} placeholder="XXXXXXXX-X" required /></span>
          </label>

          <label className={`${labelClass} mb-5`}>Primary phone
            <span className="relative block"><Phone size={14} className="pointer-events-none absolute left-2 top-[14px] text-slate-600" aria-hidden="true" /><input type="tel" name="primary_phone" value={form.primary_phone} onChange={handleChange} className={`${fieldClass} pl-8`} placeholder="+254712345678 or 0712345678" required /></span>
          </label>

          <button type="submit" disabled={loading} className="h-10 w-full bg-sky-500 text-sm font-bold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? "Registering..." : "Register Student"}
          </button>
        </form>
      </section>
    </main>
  );
}
