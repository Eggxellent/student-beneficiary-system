import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, ChevronDown, LogOut } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

function initials(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function humanize(action) {
  const text = String(action || "").replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function timeAgo(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString();
}

export default function HeaderActions({ tone = "light" }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationsError, setNotificationsError] = useState("");
  const containerRef = useRef(null);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin) return undefined;
    let active = true;
    api.get("/audit-logs")
      .then(({ data }) => { if (active) setNotifications(Array.isArray(data) ? data.slice(0, 6) : []); })
      .catch(() => { if (active) setNotificationsError("Could not load notifications."); });
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    function close(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(null);
    }
    function escape(event) {
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", escape);
    };
  }, []);

  if (!user) return null;

  const dark = tone === "dark";
  const triggerClass = dark
    ? "text-white/80 hover:bg-white/10 hover:text-white"
    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800";
  const panelClass = "absolute right-0 top-full z-40 mt-2 w-72 rounded-md border border-slate-200 bg-white p-2 text-slate-800 shadow-lg";

  function signOut() {
    setOpen(null);
    logout();
    navigate("/login", { replace: true });
  }


  return (
    <div ref={containerRef} className="relative flex items-center gap-1 sm:gap-2">
      {isAdmin && (
        <div className="relative">
          <button
            type="button"
            aria-label={notifications.length ? `Notifications (${notifications.length})` : "Notifications"}
            aria-haspopup="true"
            aria-expanded={open === "alerts"}
            onClick={() => setOpen(open === "alerts" ? null : "alerts")}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full transition ${triggerClass}`}
          >
            <Bell size={16} aria-hidden="true" />
            {notifications.length > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#C8A45D] px-1 text-[9px] font-bold text-[#173D35]">
                {notifications.length}
              </span>
            )}
          </button>
          {open === "alerts" && (
            <div className={panelClass} role="dialog" aria-label="Notifications">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Recent activity</p>
              {notificationsError && <p className="px-2 py-2 text-xs text-red-600">{notificationsError}</p>}
              {!notificationsError && notifications.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">No notifications yet.</p>}
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {notifications.map((entry) => (
                  <li key={entry.id} className="px-2 py-2">
                    <p className="text-xs font-medium text-slate-800">{humanize(entry.action)}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {(entry.user_name || entry.user_email || "System")} · {timeAgo(entry.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => { setOpen(null); navigate("/audit"); }}
                className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-[#245747] hover:bg-slate-50"
              >
                View all audit logs
              </button>
            </div>
          )}
        </div>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(open === "user" ? null : "user")}
          aria-haspopup="true"
          aria-expanded={open === "user"}
          aria-label={`Signed in as ${user.full_name || user.email}`}
          className={`flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition ${dark ? "hover:bg-white/10" : "hover:bg-slate-100"}`}
        >
          <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${dark ? "bg-[#C8A45D] text-[#173D35]" : "bg-blue-50 text-blue-600"}`}>
            {initials(user.full_name || user.email)}
          </span>
          <span className="hidden text-left sm:block">
            <span className={`block text-[11px] font-semibold leading-tight ${dark ? "text-white" : "text-slate-800"}`}>{user.full_name || user.email}</span>
            <span className={`block text-[10px] leading-tight ${dark ? "text-white/60" : "text-slate-500"}`}>{user.role === "admin" ? "Admin" : "Field Officer"}</span>
          </span>
          <ChevronDown size={14} className={dark ? "text-white/70" : "text-slate-400"} aria-hidden="true" />
        </button>
        {open === "user" && (
          <div className={panelClass} role="menu" aria-label="Account">
            <div className="border-b border-slate-100 px-2 pb-2">
              <p className="text-sm font-semibold text-slate-900">{user.full_name || "Administrator"}</p>
              <p className="text-xs text-slate-500">{user.email}</p>
              <p className="mt-1 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                {user.role === "admin" ? "Admin" : "Field Officer"}
              </p>
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={signOut}
              className="mt-1 flex w-full items-center gap-2 rounded px-2 py-2 text-xs font-semibold text-red-700 hover:bg-red-50"
            >
              <LogOut size={14} aria-hidden="true" /> Sign out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
