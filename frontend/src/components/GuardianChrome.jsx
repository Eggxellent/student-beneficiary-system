import { Component, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  Files,
  GraduationCap,
  LayoutDashboard,
  UserRound,
} from "lucide-react";
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

// Dashboard navigation keeps the in-page anchors for the sections that remain on the dashboard; the
// Account destination is a route because account settings live on their own page.
export const DASHBOARD_NAV_ITEMS = [
  { label: "Dashboard", href: "#dashboard", active: true },
  { label: "My Applications", href: "#applications" },
  { label: "Account", href: GUARDIAN_PATHS.profile },
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

const SIDEBAR_ITEMS = [
  { key: "dashboard", label: "Dashboard", href: GUARDIAN_PATHS.dashboard, icon: LayoutDashboard },
  { key: "applications", label: "My Applications", href: GUARDIAN_PATHS.myApplications, icon: Files },
  { key: "new-application", label: "New Application", href: GUARDIAN_PATHS.newApplication, icon: FilePlus2 },
  { key: "account", label: "Account", href: GUARDIAN_PATHS.profile, icon: UserRound },
];

// Persistent left navigation for the guardian workspace. It mirrors the header links and is hidden
// below the lg breakpoint, where the header nav already covers the same destinations. Above lg the
// guardian can collapse it to an icon rail; the toggle and the collapsed tooltips follow the same
// interaction pattern as the admin dashboard navigation.
export function GuardianSidebar({ activeItem, collapsed = false, onToggle }) {
  return (
    <aside
      id="guardian-sidebar"
      aria-label="Guardian sidebar"
      className={`hidden shrink-0 border-r border-border bg-card transition-[width] duration-200 lg:block ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <nav
        aria-label="Guardian sections"
        className="sticky top-0 flex max-h-screen flex-col gap-1 overflow-y-auto px-2 py-4"
      >
        <div
          className={`flex items-center pb-2 ${
            collapsed ? "justify-center" : "justify-between px-1"
          }`}
        >
          {!collapsed && (
            <p className="px-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Guardian portal
            </p>
          )}
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            aria-controls="guardian-sidebar"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="grid size-8 place-items-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            {collapsed ? (
              <ChevronRight className="size-4" aria-hidden="true" />
            ) : (
              <ChevronLeft className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
        {SIDEBAR_ITEMS.map(({ key, label, href, icon: Icon }) => {
          const isActive = key === activeItem;
          return (
            <Link
              key={key}
              to={href}
              title={collapsed ? label : undefined}
              aria-label={label}
              aria-current={isActive ? "page" : undefined}
              className={`flex items-center gap-2.5 rounded-md py-2 text-sm transition ${
                collapsed ? "justify-center px-2" : "px-3"
              } ${
                isActive
                  ? "bg-accent font-semibold text-primary"
                  : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

// Last-resort guard so an unexpected render error shows a readable message inside the guardian
// shell instead of dropping the whole page to a blank screen.
export class GuardianErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error("Guardian page failed to render:", error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
          <div
            role="alert"
            className="rounded-xl border border-destructive/30 bg-destructive/10 px-6 py-8 text-center"
          >
            <h1 className="text-lg font-semibold text-destructive">This page could not be shown</h1>
            <p className="mt-2 text-sm leading-6 text-destructive/90">
              Something went wrong while loading this section. Your applications and account details
              are safe.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Shell shared by every guardian page: header, left sidebar and page content. `activeItem` drives
// both the header tabs and the sidebar highlight; the dashboard keeps its in-page anchors. The
// sidebar collapse choice is remembered across guardian pages, and the content column flexes to the
// remaining width. There is deliberately no promotional footer on the guardian surface.
const SIDEBAR_STATE_KEY = "sbms-guardian-sidebar-collapsed";

export function GuardianLayout({
  activeItem = "dashboard",
  guardianName = "Guardian",
  initials = "GA",
  children,
}) {
  const navItem = activeItem === "new-application" ? "applications" : activeItem;
  const navItems = activeItem === "dashboard" ? DASHBOARD_NAV_ITEMS : guardianSectionNav(navItem);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STATE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_STATE_KEY, String(sidebarCollapsed));
    } catch {
      // The layout remains usable when browser storage is unavailable.
    }
  }, [sidebarCollapsed]);

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <GuardianHeader navItems={navItems} guardianName={guardianName} initials={initials} />
      <div className="mx-auto flex w-full max-w-[100rem] items-start">
        <GuardianSidebar
          activeItem={activeItem}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((value) => !value)}
        />
        <div className="min-w-0 flex-1">
          <GuardianErrorBoundary>{children}</GuardianErrorBoundary>
        </div>
      </div>
    </div>
  );
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

