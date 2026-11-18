import { Link, NavLink } from "react-router-dom";
import { GraduationCap, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Public shell for the guardian-facing pages: one header, one footer, no staff navigation.
// Everything is wrapped in `.sbms-ui` so the Emerald & Slate layer applies here and nowhere else.
export default function PublicLayout({ children, cta = true }) {
  const { isAuthenticated, user } = useAuth();
  const staffPath = isAuthenticated
    ? user?.role === "field_officer"
      ? "/field-officer"
      : "/dashboard"
    : "/login";

  return (
    <div className="sbms-ui sb-shell">
      <header className="sb-public-header sb-print-hide">
        <div className="sb-container sb-public-header__inner">
          <Link to="/" className="sb-brand" aria-label="SBMS home">
            <span className="sb-brand__mark">
              <GraduationCap size={18} aria-hidden="true" />
            </span>
            <span>
              <span className="sb-brand__name">SBMS</span>
              <span className="sb-brand__sub">Student Beneficiary Management</span>
            </span>
          </Link>

          <nav className="sb-public-nav" aria-label="Guardian services">
            <NavLink to="/">Home</NavLink>
            <NavLink to="/apply">Apply</NavLink>
            <NavLink to="/apply/track">Track application</NavLink>
            <NavLink to="/verify-certificate">Verify a certificate</NavLink>
          </nav>

          <div className="sb-row" style={{ gap: 10 }}>
            <Link to={staffPath} className="sb-btn sb-btn--ghost sb-btn--sm">
              <ShieldCheck size={14} aria-hidden="true" />
              {isAuthenticated ? "Dashboard" : "Staff sign in"}
            </Link>
            {cta && (
              <Link to="/apply" className="sb-btn sb-btn--primary sb-btn--sm">
                Apply for bursary
              </Link>
            )}
          </div>
        </div>
      </header>

      <main style={{ flex: "1 1 auto" }}>{children}</main>

      <footer className="sb-footer sb-print-hide">
        <div className="sb-container">
          <div className="sb-footer__inner">
            <div>
              <p className="sb-brand__name">SBMS</p>
              <p className="sb-meta" style={{ marginTop: 6 }}>
                Student Beneficiary Management System · NG-CDF bursary programme
              </p>
              <p className="sb-meta">Constituency bursary office · contact details available at the office</p>
            </div>
            <nav className="sb-footer__links" aria-label="Footer">
              <Link to="/apply">Apply for a bursary</Link>
              <Link to="/apply/track">Track an application</Link>
              <Link to="/verify-certificate">Verify a certificate</Link>
              <Link to="/login">Staff sign in</Link>
              <a href="#privacy">Privacy notice</a>
            </nav>
          </div>
          <p className="sb-footer__legal" id="privacy">
            Information submitted through this portal is used only to process the bursary application,
            including duplicate screening, eligibility verification and award decisions. A submitted
            application is not an approval, and an approved award is not a payment.
          </p>
        </div>
      </footer>
    </div>
  );
}
