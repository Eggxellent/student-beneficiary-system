import { GraduationCap, Lock } from "lucide-react";
import { Link } from "react-router-dom";

// Shared shell for the two unauthenticated verification pages (`/verify` and
// `/verify-certificate`). One shell means a stranger scanning either code sees the same branding,
// spacing and privacy promise. It is scoped to `.sbms-ui`, so Admin pages are unaffected.

const TONES = {
  success: "sb-alert sb-alert--success",
  danger: "sb-alert sb-alert--error",
  warning: "sb-alert sb-alert--warning",
  neutral: "sb-alert",
};

const ICON_TONES = {
  success: "sb-badge--success",
  danger: "sb-badge--danger",
  warning: "sb-badge--warning",
  neutral: "sb-badge--neutral",
};

export function PublicVerificationLayout({ children }) {
  return (
    <div className="sbms-ui sb-shell">
      <header className="sb-public-header sb-print-hide">
        <div className="sb-container sb-public-header__inner" style={{ maxWidth: 620 }}>
          <Link to="/" className="sb-brand" aria-label="SBMS home">
            <span className="sb-brand__mark">
              <GraduationCap size={18} aria-hidden="true" />
            </span>
            <span>
              <span className="sb-brand__name">SBMS</span>
              <span className="sb-brand__sub">Student Beneficiary Management System</span>
            </span>
          </Link>
          <Link to="/" className="sb-btn sb-btn--ghost sb-btn--sm">
            Home
          </Link>
        </div>
      </header>

      <main style={{ flex: "1 1 auto", padding: "36px 0 48px" }}>
        <div className="sb-container" style={{ maxWidth: 620 }}>
          <div className="sb-card sb-card--pad sb-animate-rise" aria-live="polite">
            {children}
          </div>

          <p className="sb-meta" style={{ marginTop: 18, display: "flex", gap: 8 }}>
            <Lock size={14} aria-hidden="true" style={{ marginTop: 2, flex: "0 0 auto" }} />
            Answers come live from the SBMS database. No ID numbers, dates of birth, contacts or documents
            are shown here.
          </p>
        </div>
      </main>
    </div>
  );
}

export function StatusBadge({ tone = "neutral", icon: Icon, children }) {
  return (
    <div className={`${TONES[tone]} sb-animate-rise`.trim()}>
      <span className={`sb-badge ${ICON_TONES[tone]}`} style={{ alignSelf: "flex-start" }}>
        {Icon && <Icon size={14} aria-hidden="true" />}
        {children}
      </span>
    </div>
  );
}

export function DetailRow({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div className="sb-dl__row">
      <dt>{label}</dt>
      <dd className={mono ? "sb-code" : undefined}>{value}</dd>
    </div>
  );
}

export function LoadingState({ message }) {
  return (
    <p className="sb-row" role="status" style={{ gap: 10 }}>
      <span className="sb-spin" aria-hidden="true">
        <span
          style={{
            display: "block",
            width: 18,
            height: 18,
            borderRadius: "50%",
            border: "2px solid #d7e2dd",
            borderTopColor: "var(--sb-primary)",
          }}
        />
      </span>
      <span className="sb-subtitle">{message}</span>
    </p>
  );
}

export function RetryButton({ onClick, children = "Check again" }) {
  return (
    <button type="button" onClick={onClick} className="sb-btn sb-btn--primary">
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

