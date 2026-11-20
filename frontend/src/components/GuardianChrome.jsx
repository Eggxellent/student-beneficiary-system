import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, GraduationCap } from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Shared chrome for the guardian surface (dashboard, application form, list, details and account).
// The guardian pages deliberately do not use AppLayout: they are the bursary-facing pages and must
// not show the staff sidebar. The sign-out item clears the same stored token the staff sign-in uses.

export const GUARDIAN_PATHS = {
  dashboard: "/guardian/dashboard",
  myApplications: "/guardian/applications",
  newApplication: "/guardian/applications/new",
  profile: "/guardian/profile",
};

// Dashboard navigation stays in-page because that page already holds all three sections.
export const DASHBOARD_NAV_ITEMS = [
  { label: "Dashboard", href: "#dashboard", active: true },
  { label: "My Applications", href: "#applications" },
  { label: "Account", href: "#account" },
];

// Navigation for the pages below the dashboard: the same three destinations, reached by route (or
// route plus section) instead of by in-page anchor.
export function guardianSectionNav(activeItem) {
  return [
    { label: "Dashboard", href: GUARDIAN_PATHS.dashboard, active: activeItem === "dashboard" },
    {
      label: "My Applications",
      href: GUARDIAN_PATHS.myApplications,
      active: activeItem === "applications",
    },
    { label: "Account", href: GUARDIAN_PATHS.profile, active: activeItem === "account" },
  ];
}

function navLinkClass(isActive) {
  return isActive
    ? "border-b-2 border-b-primary pb-1 text-sm font-semibold text-primary"
    : "pb-1 text-sm font-medium text-muted-foreground hover:text-foreground";
}

export function ProfileMenu({ guardianName = "Guardian", initials = "GA" }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const handleSignOut = () => {
    setOpen(false);
    logout();
    navigate("/login", { replace: true });
  };

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label="Profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-auto items-center gap-3 rounded-md px-2 py-1.5 transition hover:bg-muted"
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground">
          {initials}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold text-foreground">{guardianName}</span>
          <span className="block text-xs text-muted-foreground">Guardian</span>
        </span>
        <ChevronDown className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profile menu"
          className="absolute right-0 z-20 mt-2 w-52 overflow-hidden rounded-lg border border-border bg-card py-1 shadow-lg"
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {guardianName}
          </p>
          <hr className="border-0 border-t border-border" />
          <Link
            to={GUARDIAN_PATHS.profile}
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3 py-2 text-sm text-foreground hover:bg-muted"
          >
            Account settings
          </Link>
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function GuardianHeader({
  navItems = DASHBOARD_NAV_ITEMS,
  guardianName = "Guardian",
  initials = "GA",
}) {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-10">
        <Link
          to={GUARDIAN_PATHS.dashboard}
          aria-label="SBMS logo"
          className="flex min-w-0 items-center gap-3"
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
            <GraduationCap className="size-5" aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
            <span className="text-xl font-semibold tracking-tight text-primary">SBMS</span>
            <span className="hidden text-xs font-medium uppercase tracking-widest text-muted-foreground lg:inline">
              Student Beneficiary Management System
            </span>
          </div>
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-7 md:flex">
          {/* Anything that targets a section of a page stays a plain anchor so the browser handles
              the fragment, including when that section lives on another route. */}
          {navItems.map((item) =>
            item.href.includes("#") ? (
              <a
                key={item.label}
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={navLinkClass(item.active)}
              >
                {item.label}
              </a>
            ) : (
              <Link
                key={item.label}
                to={item.href}
                aria-current={item.active ? "page" : undefined}
                className={navLinkClass(item.active)}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <ProfileMenu guardianName={guardianName} initials={initials} />
      </div>
    </header>
  );
}

export function GuardianFooter({ maxWidthClass = "max-w-7xl" }) {
  return (
    <footer
      className={`mx-auto w-full ${maxWidthClass} px-4 pb-8 pt-2 text-xs text-muted-foreground sm:px-6 lg:px-10`}
    >
      SBMS · Secure guardian access for bursary applications
    </footer>
  );
}
