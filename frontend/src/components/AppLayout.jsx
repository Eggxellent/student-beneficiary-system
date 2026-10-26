import { Link, useLocation } from "react-router-dom";
import { BadgeCheck, FileText, GraduationCap, LayoutDashboard, LogOut, Settings, ShieldAlert, UserCog, UserPlus, Users, Wallet } from "lucide-react";
import { useAuth } from "../context/AuthContext";

const navigationByRole = {
  admin: [
    { name: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
    { name: "Duplicate Review", path: "/duplicate-review", icon: ShieldAlert },
    { name: "Awards", path: "/disbursements", icon: Wallet },
    { name: "Audit Logs", path: "/audit", icon: FileText },
    { name: "Users", path: "/users", icon: UserCog },
    { name: "Reports", path: "/reports", icon: FileText },
    { name: "Settings", path: "/settings", icon: Settings },
  ],
  field_officer: [
    { name: "Dashboard", path: "/field-officer", icon: LayoutDashboard },
    { name: "Students", path: "/students", icon: Users },
    { name: "Register Student", path: "/students/register", icon: UserPlus },
    { name: "Eligibility", path: "/eligibility", icon: BadgeCheck },
    { name: "Disbursements", path: "/disbursements", icon: Wallet },
  ],
};

export default function AppLayout({ children }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigation = navigationByRole[user?.role] || [];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-[#245747] bg-[#173D35] text-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link to="/dashboard" className="flex items-center gap-2 text-sm font-bold tracking-tight text-white">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-[#C8A45D] text-[#173D35]"><GraduationCap size={15} aria-hidden="true" /></span>
            SBMS
          </Link>
          <div className="flex items-center gap-3 text-xs text-white/75">
            <span className="hidden sm:inline">{user?.full_name || "Administrator"}</span>
              <button type="button" onClick={logout} className="flex items-center gap-1.5 rounded border border-white/25 px-3 py-1.5 font-medium text-white hover:bg-white/10 hover:text-white">
                <LogOut size={14} aria-hidden="true" />
              Logout
            </button>
          </div>
        </div>
        <nav aria-label="Main navigation" className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 pb-3 sm:px-6">
          {navigation.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition ${
                  isActive ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"
                }`}
              >
                <item.icon size={15} strokeWidth={1.8} aria-hidden="true" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
