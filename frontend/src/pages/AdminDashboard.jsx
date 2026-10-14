import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight, BadgeCheck, Bell, ChevronDown, Clock3, FileText, GraduationCap, LayoutDashboard, LogOut, Plus, Search, Settings, ShieldAlert, Users, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import api from "../services/api";

const navigation = [
  { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { name: "Students", path: "/students", icon: Users },
  { name: "Duplicate Review", path: "/duplicate-review", icon: ShieldAlert },
  { name: "Eligibility", path: "/eligibility", icon: BadgeCheck },
  { name: "Disbursements", path: "/disbursements", icon: Wallet },
  { name: "Reports", path: "/reports", icon: FileText },
];

function rows(data) {
  return Array.isArray(data) ? data : data?.value || [];
}

let dashboardRequest;

function fetchDashboardData() {
  if (!dashboardRequest) {
    dashboardRequest = Promise.all([
      api.get("/students"),
      api.get("/duplicate-flags?status=pending"),
      api.get("/disbursements"),
      api.get("/audit-logs"),
    ]).finally(() => {
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
  if (action?.includes("DUPLICATE")) return { label: "Duplicate Alert", detail: "Duplicate record review updated", icon: ShieldAlert, color: "bg-orange-50 text-orange-600" };
  if (action?.includes("DISBURSEMENT")) return { label: "Disbursement", detail: "Disbursement record created", icon: Wallet, color: "bg-purple-50 text-purple-600" };
  if (action?.includes("CREATE")) return { label: "Student Registration", detail: "New student registration completed", icon: Plus, color: "bg-blue-50 text-blue-600" };
  return { label: action?.replaceAll("_", " ") || "System Activity", detail: "System activity recorded", icon: FileText, color: "bg-slate-100 text-slate-600" };
}

function buildTrend(items, dateField) {
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date();
    date.setMonth(date.getMonth() - (5 - index), 1);
    return { key: `${date.getFullYear()}-${date.getMonth()}`, label: date.toLocaleString("en", { month: "short" }), students: 0 };
  });

  items.forEach((item) => {
    const createdAt = new Date(item[dateField]);
    const key = `${createdAt.getFullYear()}-${createdAt.getMonth()}`;
    const month = months.find((item) => item.key === key);
    if (month) month.students += 1;
  });

  return months.reduce((trend, month, index) => {
    const previous = trend[index - 1]?.total || 0;
    trend.push({ ...month, total: previous + month.students });
    return trend;
  }, []);
}

export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [cachedDashboard, setCachedDashboard] = useState(() => readDashboardCache(user?.id));
  const [students, setStudents] = useState([]);
  const [flags, setFlags] = useState([]);
  const [disbursements, setDisbursements] = useState([]);
  const [activities, setActivities] = useState(() => cachedDashboard?.activities || []);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(() => cachedDashboard?.lastUpdated ? new Date(cachedDashboard.lastUpdated) : null);

  async function loadDashboard() {
    try {
      setLoading(true);
      setLoadError("");
      const [studentsResponse, flagsResponse, disbursementsResponse, activitiesResponse] = await fetchDashboardData();
      const studentsData = rows(studentsResponse.data);
      const flagsData = rows(flagsResponse.data);
      const disbursementsData = rows(disbursementsResponse.data);
      const activitiesData = rows(activitiesResponse.data);
      const updatedAt = new Date();
      const dashboardCache = {
        totalStudents: studentsData.length,
        eligibleStudents: studentsData.filter((student) => ["eligible", "highly_eligible"].includes(student.eligibility_category)).length,
        duplicateCount: flagsData.length,
        trend: buildTrend(studentsData, "created_at"),
        disbursementTrend: buildTrend(disbursementsData, "disbursement_date"),
        activities: activitiesData.slice(0, 4).map(({ action, created_at }, index) => ({ id: `${created_at}-${index}`, action, created_at })),
        lastUpdated: updatedAt.toISOString(),
      };

      setStudents(studentsData);
      setFlags(flagsData);
      setDisbursements(disbursementsData);
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
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard();
  }, []);

  const trend = cachedDashboard?.trend || buildTrend(students, "created_at");
  const disbursementTrend = cachedDashboard?.disbursementTrend || buildTrend(disbursements, "disbursement_date");
  const maxTrend = Math.max(...trend.map((item) => item.total), ...disbursementTrend.map((item) => item.total), 1);
  const totalStudents = cachedDashboard?.totalStudents ?? students.length;
  const eligibleStudents = cachedDashboard?.eligibleStudents ?? students.filter((student) => ["eligible", "highly_eligible"].includes(student.eligibility_category)).length;
  const duplicateCount = cachedDashboard?.duplicateCount ?? flags.length;
  const statistics = [
    { label: "Total Students", value: totalStudents.toLocaleString(), detail: "Registered students", icon: Users, color: "bg-blue-50 text-blue-600" },
    { label: "Eligible Students", value: eligibleStudents.toLocaleString(), detail: "Stored eligible assessments", icon: BadgeCheck, color: "bg-green-50 text-green-600" },
    { label: "Duplicate Alerts", value: duplicateCount.toLocaleString(), detail: "Potential duplicate records", icon: ShieldAlert, color: "bg-orange-50 text-orange-600" },
    { label: "Pending Reviews", value: duplicateCount.toLocaleString(), detail: "Cases requiring review", icon: Clock3, color: "bg-purple-50 text-purple-600" },
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-56 flex-col border-r border-slate-200 bg-blue-50/70 sm:flex">
        <div className="flex h-12 items-center gap-2 border-b border-slate-200 px-4">
          <div className="flex h-5 w-5 items-center justify-center rounded bg-blue-600 text-white"><GraduationCap size={13} aria-hidden="true" /></div>
          <span className="text-sm font-bold tracking-tight text-slate-800">SBMS</span>
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
                    ? "bg-blue-50 text-blue-600"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <item.icon size={15} strokeWidth={1.8} aria-hidden="true" />
                <span>{item.name}</span>
                {isActive && <span className="ml-auto text-blue-500">›</span>}
              </Link>
            );
          })}

          <Link
            to="/settings"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <Settings size={15} strokeWidth={1.8} aria-hidden="true" />
            <span>Settings</span>
          </Link>
        </nav>

        <div className="border-t border-slate-200 p-3">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[11px] font-medium text-slate-600 transition hover:bg-red-50 hover:text-red-600"
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
                System Active
              </p>
              <h2 className="text-xl font-bold text-slate-900">Good morning, {user?.full_name?.split(" ")[0] || "Admin"} 👋</h2>
              <p className="mt-1 max-w-xl text-[11px] text-slate-500">
                Here&apos;s an overview of your student beneficiaries and the activities that require your attention.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  to="/students/register"
                  className="flex items-center gap-1.5 rounded bg-blue-600 px-3 py-2 text-[10px] font-semibold text-white transition hover:bg-blue-700"
                >
                  <Plus size={13} aria-hidden="true" />
                  Register Student
                </Link>
                <Link
                  to="/duplicate-review"
                  className="rounded border border-slate-200 px-3 py-2 text-[10px] font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Review Duplicates
                </Link>
              </div>
            </div>

            <div className="hidden h-24 w-40 items-center justify-center rounded-sm bg-[linear-gradient(135deg,#17477d,#e69d35)] text-white shadow-inner md:flex">
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

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Student Overview</h3>
                  <p className="mt-1 text-sm text-slate-500">Student registration and disbursement trends</p>
                </div>
                <div className="flex items-center gap-3">
                  <button type="button" onClick={loadDashboard} disabled={loading} className="text-sm font-medium text-slate-500 hover:text-blue-700 disabled:opacity-50">
                    {loading ? "Refreshing..." : "Refresh"}
                  </button>
                  <Link to="/reports" className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">View Full Report <ArrowRight size={14} aria-hidden="true" /></Link>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-6 text-xs text-slate-500">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                  Total Students
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                  Disbursements
                </div>
              </div>

              <div className="mt-5 h-40 border-b border-slate-200 bg-[repeating-linear-gradient(to_bottom,transparent_0,transparent_31px,#e2e8f0_32px)] px-2">
                <svg viewBox="0 0 600 160" className="h-full w-full" role="img" aria-label="Student registration trend">
                  <defs>
                    <linearGradient id="studentTrend" x1="0" x2="0" y1="0" y2="1">
                      <stop offset="0%" stopColor="#2563eb" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    d={`M 0,160 ${trend.map((item, index) => `L ${(index / (trend.length - 1 || 1)) * 600},${160 - (item.total / maxTrend) * 130}`).join(" ")} L 600,160 Z`}
                    fill="url(#studentTrend)"
                  />
                  <polyline
                    points={trend.map((item, index) => `${(index / (trend.length - 1 || 1)) * 600},${160 - (item.total / maxTrend) * 130}`).join(" ")}
                    fill="none"
                    stroke="#2563eb"
                    strokeWidth="3"
                  />
                  <polyline
                    points={disbursementTrend.map((item, index) => `${(index / (disbursementTrend.length - 1 || 1)) * 600},${160 - (item.total / maxTrend) * 130}`).join(" ")}
                    fill="none"
                    stroke="#0f766e"
                    strokeWidth="2"
                  />
                </svg>
              </div>

              <div className="mt-3 flex justify-between px-2 text-xs text-slate-400">
                {trend.map((item) => <span key={item.key}>{item.label}</span>)}
              </div>
              <p className="mt-3 text-right text-[9px] text-slate-400">
                {lastUpdated ? `Last updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading dashboard data"}
              </p>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-lg font-semibold text-slate-800">Quick Actions</h3>
              <p className="mt-1 text-sm text-slate-500">Commonly performed operations.</p>

              <div className="mt-6 space-y-3">
                <Link
                  to="/students/register"
                  className="flex items-center justify-between rounded-lg bg-blue-600 px-4 py-4 text-sm font-semibold text-white transition hover:bg-blue-700"
                >
                  <span className="flex items-center gap-2"><Plus size={15} aria-hidden="true" /> Register Student</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <Link
                  to="/duplicate-review"
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2"><ShieldAlert size={15} aria-hidden="true" /> Review Duplicates</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
                <Link
                  to="/reports"
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-4 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  <span className="flex items-center gap-2"><FileText size={15} aria-hidden="true" /> View Reports</span>
                  <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Duplicate Review</h3>
                  <p className="mt-1 text-sm text-slate-500">Potential duplicate records requiring review.</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-50 text-orange-600"><ShieldAlert size={19} aria-hidden="true" /></div>
              </div>

              <div className="mt-6">
                <p className="text-4xl font-bold text-slate-900">{duplicateCount}</p>
                <p className="mt-1 text-sm text-slate-500">Potential duplicates</p>
              </div>

              <div className="mt-5 rounded-lg bg-orange-50 p-4">
                <p className="text-sm font-medium text-orange-800">{duplicateCount} require human review</p>
                <p className="mt-1 text-xs text-orange-700">Review flagged records before taking further action.</p>
              </div>

              <Link
                to="/duplicate-review"
                className="mt-5 block w-full rounded-lg bg-orange-500 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-orange-600"
              >
                <span className="inline-flex items-center gap-1.5">Review Duplicates <ArrowRight size={15} aria-hidden="true" /></span>
              </Link>
            </div>

            <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-800">Recent Activity</h3>
                  <p className="mt-1 text-sm text-slate-500">Recent updates from the student beneficiary management system.</p>
                </div>
                <button type="button" className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">See All <ArrowRight size={14} aria-hidden="true" /></button>
              </div>

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
                {activities.length === 0 && <p className="py-6 text-sm text-slate-500">No recent activity recorded.</p>}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}