import { useEffect, useState } from "react";
import { CalendarDays, CreditCard, FileText, Phone } from "lucide-react";
import api from "../services/api";

const emptyForm = { first_name: "", last_name: "", date_of_birth: "", school_code: "", national_id_number: "", birth_certificate_number: "", upi: "", primary_phone: "" };

// The registration screen carries the standard formats. A value that does not match is flagged
// on the field itself and the form refuses to submit, so the duplicate model is never asked to
// compare an identifier the office could not have issued.
const FORMATS = {
  guardian_id_number: {
    pattern: /^\d{8}$/,
    message: "National ID must be exactly 8 digits.",
  },
  birth_certificate_number: {
    pattern: /^BC-\d{1,3}$/i,
    message: "Use BC-123: BC- followed by up to 3 digits.",
  },
  upi: {
    pattern: /^UPI-\d{1,3}$/i,
    message: "Use UPI-123: UPI- followed by up to 3 digits.",
  },
  primary_phone: {
    pattern: /^[17]\d{8}$/,
    message: "Enter the 9 digits after +254, e.g. 712345678.",
  },
};
const REQUIRED_FORMATS = ["national_id_number", "primary_phone"];

function validateForm(values) {
  const errors = {};
  for (const [name, rule] of Object.entries(FORMATS)) {
    const value = String(values[name] || "").trim();
    if (!value) {
      if (REQUIRED_FORMATS.includes(name)) errors[name] = "This field is required.";
      continue;
    }
    if (!rule.pattern.test(value)) errors[name] = rule.message;
  }
  return errors;
}

export default function StudentRegistration() {
  const [form, setForm] = useState(emptyForm);
  const [schools, setSchools] = useState([]);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get("/students/schools").then(({ data }) => setSchools(data)).catch(() => setSchools([]));
  }, []);

  function clearFieldError(name) {
    setFieldErrors((current) => (current[name] ? { ...current, [name]: "" } : current));
  }

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    clearFieldError(name);
  }

  // "+254" is fixed on screen, so the officer only types the 9 national digits. A pasted
  // "+254 712 345 678" or "0712345678" is reduced to those same 9 digits.
  function handlePhoneChange(event) {
    const digits = event.target.value.replace(/\D/g, "").replace(/^254/, "").replace(/^0/, "").slice(0, 9);
    setForm((current) => ({ ...current, primary_phone: digits }));
    clearFieldError("primary_phone");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const validationErrors = validateForm(form);
    setFieldErrors(validationErrors);
    setError("");
    setResult(null);
    if (Object.keys(validationErrors).length > 0) {
      setError("Check the highlighted fields before registering.");
      return;
    }
    setLoading(true);
    try {
      const response = await api.post("/students", {
        full_name: `${form.first_name.trim()} ${form.last_name.trim()}`,
        date_of_birth: form.date_of_birth,
        school_code: form.school_code,
        national_id_number: form.national_id_number.trim(),
        primary_phone: `+254${form.primary_phone.trim()}`,
        // The API stores both identifiers as optional, so a blank box must not send an empty
        // string: an absent identifier can never be reported as an exact match.
        ...(form.birth_certificate_number.trim() ? { birth_certificate_number: form.birth_certificate_number.trim().toUpperCase() } : {}),
        ...(form.upi.trim() ? { upi: form.upi.trim().toUpperCase() } : {}),
      });
      setResult(response.data);
      setForm(emptyForm);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to register student.");
    } finally {
      setLoading(false);
    }
  }

  // The API publishes `risk_level: 'review'` for every case and never calls a record a duplicate.
  // This screen belongs to a field officer, so it states three facts only: saved, who, and
  // whether an administrator will look at it. Cutoffs, candidate counts and model version are
  // administrator detail and stay on the review, reporting and audit screens.
  const flags = result?.duplicate_flags || [];
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
  const invalidFieldClass = "border-red-400 bg-red-50 focus:border-red-500";
  const inputClass = (name, extra = "") => `${fieldClass} ${extra}${fieldErrors[name] ? ` ${invalidFieldClass}` : ""}`;
  const errorText = (name) => (fieldErrors[name]
    ? <span className="mt-1 block text-[11px] font-semibold normal-case tracking-normal text-red-600" role="alert">{fieldErrors[name]}</span>
    : null);

  return (
    <main className="mx-auto max-w-[560px] px-4 py-8 sm:py-12">
      {result && (
        <section className={`mb-5 flex items-center gap-4 border p-4 text-sm ${panelClass}`} role="status">
          {result.qr_code && <img src={result.qr_code} alt="Student QR code" className="h-20 w-20 shrink-0 border border-slate-300 bg-white p-1" />}
          <div className="min-w-0">
            <h2 className="font-bold">{duplicate ? "Student registered - review pending" : "Student registered"}</h2>
            <p className="mt-0.5 truncate text-xs">
              {result.student?.full_name || result.message}
              {result.student?.school_code ? ` - ${result.student.school_code}` : ""}
            </p>
            {duplicate && <p className="mt-1">Possible duplicate. An admin must clear it before any award is approved.</p>}
          </div>
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
            <span className="relative block"><CreditCard size={14} className="pointer-events-none absolute left-2 top-[14px] text-slate-600" aria-hidden="true" /><input name="national_id_number" inputMode="numeric" maxLength={8} value={form.national_id_number} onChange={handleChange} className={inputClass("national_id_number", "pl-8")} placeholder="12345678" aria-invalid={Boolean(fieldErrors.national_id_number)} required /></span>
            {errorText("national_id_number")}
          </label>

          {/* Optional, but these two are the identifiers that carry a critical exact-match rule,
              so an officer who has the document should record it here. */}
          <label className={`${labelClass} mb-3`}>Birth certificate number
            <span className="relative block"><FileText size={14} className="pointer-events-none absolute left-2 top-[14px] text-slate-600" aria-hidden="true" /><input name="birth_certificate_number" maxLength={6} value={form.birth_certificate_number} onChange={handleChange} className={inputClass("birth_certificate_number", "pl-8")} placeholder="BC-123" aria-invalid={Boolean(fieldErrors.birth_certificate_number)} autoComplete="off" /></span>
            {errorText("birth_certificate_number")}
          </label>

          <label className={`${labelClass} mb-3`}>UPI
            <span className="relative block"><FileText size={14} className="pointer-events-none absolute left-2 top-[14px] text-slate-600" aria-hidden="true" /><input name="upi" maxLength={7} value={form.upi} onChange={handleChange} className={inputClass("upi", "pl-8")} placeholder="UPI-123" aria-invalid={Boolean(fieldErrors.upi)} autoComplete="off" /></span>
            {errorText("upi")}
          </label>

          <label className={`${labelClass} mb-5`}>Primary phone
            <span className="relative block">
              <Phone size={14} className="pointer-events-none absolute left-2 top-[14px] text-slate-600" aria-hidden="true" />
              <span className="pointer-events-none absolute left-7 top-[20px] text-sm font-medium text-slate-600">+254</span>
              <input type="tel" name="primary_phone" inputMode="numeric" maxLength={9} value={form.primary_phone} onChange={handlePhoneChange} className={inputClass("primary_phone", "pl-[72px]")} placeholder="712345678" aria-invalid={Boolean(fieldErrors.primary_phone)} autoComplete="off" required />
            </span>
            {errorText("primary_phone")}
          </label>

          <button type="submit" disabled={loading} className="h-10 w-full bg-sky-500 text-sm font-bold text-white hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60">
            {loading ? "Registering..." : "Register Student"}
          </button>
        </form>
      </section>
    </main>
  );
}
