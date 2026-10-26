import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, BadgeCheck, Bell, ChevronDown, Clock3, FileText, GraduationCap, LayoutDashboard, LogOut, Plus, Search, Settings, ShieldAlert, Users, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

const navigation = [
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Duplicate Review", path: "/duplicate-review", icon: ShieldAlert },
  { name: "Audit Logs", path: "/audit", icon: Clock3 },
  { name: "Users", path: "/users", icon: Users },
  { name: "Reports", path: "/reports", icon: FileText },
];

let dashboardRequest;

function fetchDashboardData() {
  if (!dashboardRequest) {
    dashboardRequest = api.get("/admin/dashboard").then((response) => response.data).finally(() => {
      dashboardRequest = null;
    });
  }

  return dashboardRequest;
}

function readDashboardCache(userId) {
  if (!userId) return null;

  try {
    const cached = JSON.parse(localStorage.getItem(`sbms-dashboard-v1:${userId}`));
    if (
      !cached ||
      !Number.isFinite(cached.totalStudents) ||
      !Number.isFinite(cached.eligibleStudents) ||
      !Number.isFinite(cached.syntheticStudents) ||
      !Number.isFinite(cached.duplicateCount) ||
      !Array.isArray(cached.trend) ||
      !Array.isArray(cached.disbursementTrend) ||
      !Array.isArray(cached.activities)
    ) return null;

    return cached;
  } catch {
    return null;
  }
}

function formatRelativeTime(value) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} mins ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

function activityDetails(action) {
  if (action?.includes("DUPLICATE")) return { label: "Duplicate review", detail: "Review updated", icon: ShieldAlert, color: "bg-orange-50 text-orange-600" };
  if (action?.includes("DISBURSEMENT")) return { label: "Disbursement", detail: "Created", icon: Wallet, color: "bg-purple-50 text-purple-600" };
  if (action?.includes("CREATE")) return { label: "Registration", detail: "Student added", icon: Plus, color: "bg-blue-50 text-blue-600" };
  return { label: action?.replaceAll("_", " ") || "System activity", detail: "Activity logged", icon: FileText, color: "bg-slate-100 text-slate-600" };
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [cachedDashboard, setCachedDashboard] = useState(() => readDashboardCache(user?.id));
  const [activities, setActivities] = useState(() => cachedDashboard?.activities || []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(() => cachedDashboard?.lastUpdated ? new Date(cachedDashboard.lastUpdated) : null);

  async function loadDashboard({ silent = false } = {}) {
    try {
      if (!silent) setLoading(true);
      setLoadError("");
      const dashboardData = await fetchDashboardData();
      const dashboardCache = {
        ...dashboardData,
        activities: dashboardData.activities.slice(0, 4).map(({ action, created_at }, index) => ({ id: `${created_at}-${index}`, action, created_at })),
      };
      const updatedAt = new Date(dashboardCache.lastUpdated || Date.now());
      dashboardCache.lastUpdated = updatedAt.toISOString();

      setActivities(dashboardCache.activities);
      setCachedDashboard(dashboardCache);
      setLastUpdated(updatedAt);
      try {
        localStorage.setItem(`sbms-dashboard-v1:${user?.id}`, JSON.stringify(dashboardCache));
      } catch {
        // The dashboard remains usable when browser storage is unavailable.
      }
    } catch {
      setLoadError("Dashboard data could not be refreshed. Showing the last available values.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
    const refreshTimer = window.setInterval(() => loadDashboard({ silent: true }), 30_000);
    return () => window.clearInterval(refreshTimer);
  }, []);

  const trend = cachedDashboard?.trend || [];
  const disbursementTrend = cachedDashboard?.disbursementTrend || [];
  const maxTrend = Math.max(...trend.map((item) => item.total), ...disbursementTrend.map((item) => item.total), 1);
  const totalStudents = cachedDashboard?.totalStudents ?? 0;
  const eligibleStudents = cachedDashboard?.eligibleStudents ?? 0;
  const duplicateCount = cachedDashboard?.duplicateCount ?? 0;
  const accountability = cachedDashboard?.accountability || {};
  const accountabilityCards = [
    { label: "Approved awards", value: Number(accountability.approved_awards || 0).toLocaleString() },
    { label: "Awards without payment", value: Number(accountability.no_payment_awards || 0).toLocaleString() },
    { label: "Awards with payment recorded", value: Number(accountability.disbursed_awards || 0).toLocaleString() },
    { label: "Issued or cleared amount", value: `KSh ${Number(accountability.disbursed_amount || 0).toLocaleString()}` },
    { label: "Awaiting clearance", value: Number(accountability.awaiting_clearance || 0).toLocaleString() },
    { label: "Awaiting receipt", value: Number(accountability.awaiting_receipt || 0).toLocaleString() },
    { label: "Overdue receipt", value: cachedDashboard?.acknowledgementOverdueDays == null ? "Not set" : Number(accountability.overdue_receipts || 0).toLocaleString(), detail: cachedDashboard?.acknowledgementOverdueDays == null ? "Set ACKNOWLEDGEMENT_OVERDUE_DAYS" : `${cachedDashboard.acknowledgementOverdueDays}-day deadline` },
    { label: "Amount discrepancies", value: Number(accountability.amount_discrepancies || 0).toLocaleString() },
    { label: "Partial awards", value: Number(accountability.partial_awards || 0).toLocaleString() },
    { label: "Awaiting verification", value: Number(accountability.awards_awaiting_verification || 0).toLocaleString() },
  ];
  const statistics = [
    { label: "Students", value: totalStudents.toLocaleString(), detail: "Registered", icon: Users, color: "bg-blue-50 text-blue-600" },
    { label: "Eligible", value: eligibleStudents.toLocaleString(), detail: "Eligible assessments", icon: BadgeCheck, color: "bg-green-50 text-green-600" },
    { label: "Duplicate Alerts", value: duplicateCount.toLocaleString(), detail: "Potential matches", icon: ShieldAlert, color: "bg-orange-50 text-orange-600" },
    { label: "Pending Reviews", value: duplicateCount.toLocaleString(), detail: "Need review", icon: Clock3, color: "bg-purple-50 text-purple-600" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-56 flex-col border-r border-[#245747] bg-[#173D35] text-white sm:flex">
        <div className="flex h-12 items-center gap-2 border-b border-white/15 px-4">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-[#C8A45D] text-[#173D35]"><GraduationCap size={13} aria-hidden="true" /></div>
          <span className="text-sm font-bold tracking-tight text-white">SBMS</span>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {navigation.map((item) => {
            const isActive = location.pathname === item.path;

            return (
              <Link
                key={item.name}
                to={item.path}
                className={`flex items-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium transition ${
                  isActive
                    ? "bg-white/15 text-white"
                    : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.name}</span>
                {isActive && <ArrowRight size={13} className="ml-auto" aria-hidden="true" />}
              </Link>
            );
          })}

          <Link
            to="/settings"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium text-white/75 transition hover:bg-white/10 hover:text-white"
          >
            <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Settings</span>
          </Link>
        </nav>

        <div className="border-t border-white/15 p-3">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium text-white/75 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut size={14} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <main className="min-h-screen sm:ml-56">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between border-b border-slate-200 bg-white/95 px-3 backdrop-blur sm:px-4">
          <div className="flex items-center gap-2">
            <LayoutDashboard size={15} className="text-slate-500" aria-hidden="true" />
            <h1 className="text-xs font-semibold text-slate-800">Dashboard</h1>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative hidden sm:block">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                type="text"
                placeholder="Search students, UPI, school..."
                className="h-7 w-48 rounded border border-slate-200 bg-slate-50 pl-7 pr-3 text-[10px] outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
              />
            </div>

            <button type="button" aria-label="Notifications" className="text-slate-500 hover:text-slate-800"><Bell size={15} aria-hidden="true" /></button>
            <div className="h-5 w-px bg-slate-200" />

            <div className="flex items-center gap-3">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-600"><Users size={13} aria-hidden="true" /></div>
              <div className="hidden sm:block">
                <p className="text-[10px] font-medium text-slate-800">{user?.full_name || "Administrator"}</p>
                <p className="text-[9px] text-slate-500">{user?.role || "Administrator"}</p>
              </div>
              <ChevronDown size={13} className="text-slate-400" aria-hidden="true" />
            </div>
          </div>
        </header>

        <section className="mx-auto max-w-7xl p-5">
          <div className="mb-4 flex flex-col justify-between gap-4 rounded-md border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center">
            <div>
              <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-600">
                Active
              </p>
              <h2 className="text-xl font-bold text-slate-900">Welcome, {user?.full_name?.split(" ")[0] || "Admin"}</h2>
              <p className="mt-1 max-w-xl text-[11px] text-slate-500">
                Overview and items needing attention.
              </p>
            </div>

            <div className="hidden h-24 w-40 items-center justify-center rounded-sm bg-[#173D35] text-[#C8A45D] md:flex">
              <GraduationCap size={42} strokeWidth={1.4} aria-hidden="true" />
            </div>
          </div>

          {loadError && <p className="mb-3 rounded border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">{loadError}</p>}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {statistics.map((statistic) => (
              <article key={statistic.label} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[9px] font-medium uppercase text-slate-500">{statistic.label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-900">{statistic.value}</p>
                    <p className="mt-1 text-[9px] text-slate-500">{statistic.detail}</p>
                  </div>
                  <div className={`flex h-7 w-7 items-center justify-center rounded ${statistic.color}`}><statistic.icon size={16} strokeWidth={1.8} aria-hidden="true" /></div>
                </div>
              </article>
            ))}
          </div>
          <p className="mt-2 text-right text-[10px] text-slate-500">Synthetic test records included in totals: {cachedDashboard?.syntheticStudents ?? 0}</p>

          <section aria-label="Bursary accountability" className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {accountabilityCards.map((item) => (
              <article key={item.label} className="rounded-md border border-slate-200 bg-white p-3 shadow-sm">
                <p className="text-[9px] font-medium uppercase text-slate-500">{item.label}</p>
                <p className="mt-1 text-xl font-bold text-slate-900">{item.value}</p>
                {item.detail && <p className="mt-1 text-[9px] text-slate-500">{item.detail}</p>}
              </article>
            ))}
          </section>

          <div className="mt-4 grid gap-4">
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Students and Disbursements</h3>
                  <p className="mt-1 text-sm text-slate-500">Registration and disbursement trends</p>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={loadDashboard} disabled={loading} className="text-sm font-medium text-slate-500 hover:text-blue-700 disabled:opacity-50">
                    {loading ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-6 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                  Students
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  Disbursements
                </div>
              </div>

              <div className="mt-5 h-40 border-b border-slate-200 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,#dfe6e1_32px)] px-2">
                <svg viewBox="0 0 600 160" className="h-full w-full" role="img" aria-label="Student registration trend">
                  <defs>
                    <linearGradient id="studentTrend" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#173D35" stopOpacity="0.18" />
                      <stop offset="100%" stopColor="#173D35" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`M 0,160 ${trend.map((item, index) => `L ${(index / (trend.length - 1 || 1)) * 600},${160 - (item.total / maxTrend) * 130}`).join(" ")} L 600,160 Z`}
                    fill="url(#studentTrend)"
                  />
                  <polyline
                    points={trend.map((item, index) => `${(index / (trend.length - 1 || 1)) * 600},${160 - (item.total / maxTrend) * 130}`).join(" ")}
                    fill="none"
                    stroke="#173D35"
                    strokeWidth="3"
                  />
                  <polyline
                    points={disbursementTrend.map((item, index) => `${(index / (disbursementTrend.length - 1 || 1)) * 600},${160 - (item.total / maxTrend) * 130}`).join(" ")}
                    fill="none"
                    stroke="#C8A45D"
                    strokeWidth="2"
                  />
                </svg>
              </div>

              <div className="mt-3 flex justify-between px-2 text-xs text-slate-400">
                {trend.map((item) => <span key={item.key}>{item.label}</span>)}
              </div>
              <p className="mt-3 text-right text-[9px] text-slate-400">
                {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · refreshes every 30s` : "Loading data"}
              </p>
            </div>

          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Duplicate Review</h3>
                  <p className="mt-1 text-sm text-slate-500">Potential matches</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><ShieldAlert size={19} aria-hidden="true" /></div>
              </div>

              <div className="mt-6">
                <p className="text-4xl font-bold text-slate-900">{duplicateCount}</p>
                <p className="mt-1 text-sm text-slate-500">Flagged cases</p>
              </div>

              <div className="mt-5 rounded-lg bg-orange-50 p-4">
                <p className="text-sm font-medium text-orange-800">{duplicateCount} require human review</p>
                <p className="mt-1 text-xs text-orange-700">Review flags before action.</p>
              </div>

              <Link
                to="/duplicate-review"
                className="mt-5 block w-full rounded-lg bg-orange-500 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-orange-600"
              >
                <span className="inline-flex items-center gap-1.5">Review Duplicates <ArrowRight size={15} aria-hidden="true" /></span>
              </Link>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
              <h3 className="text-lg font-semibold text-slate-800">Recent Activity</h3>

              <div className="mt-6 divide-y divide-slate-100">
                {activities.slice(0, 4).map((activity) => {
                  const details = activityDetails(activity.action);
                  return (
                    <div key={activity.id} className="flex items-center gap-4 py-4">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${details.color}`}><details.icon size={17} aria-hidden="true" /></div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800">{details.label}</p>
                        <p className="mt-1 text-xs text-slate-500">{details.detail}</p>
                      </div>
                      <span className="shrink-0 text-xs text-slate-400">{formatRelativeTime(activity.created_at)}</span>
                    </div>
                  );
                })}
                {activities.length === 0 && <p className="py-6 text-sm text-slate-500">No recent activity.</p>}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
