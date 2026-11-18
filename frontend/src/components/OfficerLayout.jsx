import { useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Award,
  ClipboardCheck,
  FileText,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Field Officer shell. Only Field Officer pages are mounted inside it; the Admin interface keeps
// using the untouched AppLayout, so its sidebar, header and styling cannot change from here.
const NAV = [
  { to: "/field-officer", label: "Overview", icon: LayoutDashboard, match: (path) => path === "/field-officer" },
  {
    to: "/applications",
    label: "Applications",
    icon: FileText,
    match: (path) => path === "/applications" || path.startsWith("/applications/"),
  },
  { to: "/eligibility", label: "Eligibility verification", icon: ClipboardCheck, match: (path) => path === "/eligibility" },
  { to: "/awards", label: "Award recommendations", icon: Award, match: (path) => path === "/awards" },
];

function initials(name) {
  if (!name) return "FO";
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default function OfficerLayout({ children }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);

  const current = NAV.find((item) => item.match(location.pathname));

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className="sbms-ui sb-officer">
      {open && (
        <div className="sb-sidebar-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />
      )}

      <aside className={`sb-sidebar ${open ? "sb-sidebar--open" : ""}`} aria-label="Field Officer navigation">
        <div className="sb-sidebar__brand">
          <Link to="/field-officer" className="sb-brand" onClick={() => setOpen(false)}>
            <span className="sb-brand__mark">
              <GraduationCap size={18} aria-hidden="true" />
            </span>
            <span>
              <span className="sb-brand__name">SBMS</span>
              <span className="sb-brand__sub">Field Officer</span>
            </span>
          </Link>
        </div>

        <p className="sb-sidebar__label">Workspace</p>
        <nav className="sb-sidebar__nav">
          {NAV.map(({ to, label, icon: Icon, match }) => (
            <Link
              key={to}
              to={to}
              className="sb-sidebar__link"
              aria-current={match(location.pathname) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          ))}
        </nav>

        <div className="sb-sidebar__foot">
          <div className="sb-sidebar__user">
            <span className="sb-avatar" aria-hidden="true">
              {initials(user?.full_name)}
            </span>
            <span style={{ minWidth: 0 }}>
              <span className="sb-sidebar__user-name">{user?.full_name || "Field Officer"}</span>
              <span className="sb-sidebar__user-role">Field Officer</span>
            </span>
          </div>
          <button type="button" className="sb-btn sb-btn--ghost sb-btn--sm" onClick={handleLogout}>
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="sb-main">
        <div className="sb-topbar">
          <button
            type="button"
            className="sb-btn sb-btn--ghost sb-btn--sm sb-menu-button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-label={open ? "Close navigation" : "Open navigation"}
          >
            {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
          </button>
          <div style={{ minWidth: 0 }}>
            <p className="sb-topbar__crumbs">Field Officer workspace</p>
            <p className="sb-topbar__title">{current?.label || "Application detail"}</p>
          </div>
          <span className="sb-spacer" />
          <span className="sb-role">Field Officer</span>
        </div>

        <div className="sb-content">{children}</div>
      </div>
    </div>
  );
}
