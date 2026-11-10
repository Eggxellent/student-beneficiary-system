import { GraduationCap } from "lucide-react";

// Shared shell for the two unauthenticated verification pages (`/verify` and
// `/verify-certificate`). Keeping one shell means a stranger scanning either code sees the same
// branding, the same spacing and the same privacy promise.

const TONES = {
  success: "border-green-200 bg-green-50 text-green-900",
  danger: "border-red-200 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  neutral: "border-slate-200 bg-slate-50 text-slate-700",
};

const ICON_TONES = {
  success: "bg-green-600 text-white",
  danger: "bg-red-600 text-white",
  warning: "bg-amber-500 text-white",
  neutral: "bg-slate-500 text-white",
};

export function PublicVerificationLayout({ children }) {
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900 sm:py-16">
      <div className="mx-auto w-full max-w-xl">
        <header className="mb-6 flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-[#173D35] text-[#C8A45D]">
            <GraduationCap size={20} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold tracking-tight text-[#173D35]">SBMS</p>
            <p className="text-xs text-slate-600">Student Beneficiary Management System</p>
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8" aria-live="polite">
          {children}
        </section>

        <p className="mt-5 text-center text-xs leading-relaxed text-slate-600">
          Answers come live from the SBMS database. No ID numbers, dates of birth, contacts or
          documents are shown here.
        </p>
      </div>
    </div>
  );
}

export function StatusBadge({ tone = "neutral", icon: Icon, children }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${TONES[tone]}`}>
      {Icon && (
        <span className={`grid h-5 w-5 place-items-center rounded-full ${ICON_TONES[tone]}`}>
          <Icon size={12} strokeWidth={3} aria-hidden="true" />
        </span>
      )}
      {children}
    </span>
  );
}

export function DetailRow({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1 border-b border-slate-100 py-2 last:border-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-sm text-slate-900 ${mono ? "font-mono text-xs" : "font-semibold"} sm:text-right`}>{value}</dd>
    </div>
  );
}

export function LoadingState({ message }) {
  return (
    <div className="flex items-center gap-3 text-slate-700" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-[#173D35]" aria-hidden="true" />
      <span className="text-sm">{message}</span>
    </div>
  );
}

export function RetryButton({ onClick, children = "Check again" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-[#173D35] bg-[#173D35] px-4 py-2 text-sm font-semibold text-white hover:bg-[#245747]"
    >
      {children}
    </button>
  );
}

export function formatTimestamp(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
