import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, LogOut } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import NotificationBell from "./NotificationBell";

function initials(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export default function HeaderActions({ tone = "light" }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const containerRef = useRef(null);

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
  const panelClass = "absolute right-0 top-full z-40 mt-2 w-72 rounded-md border border-slate-200 bg-white p-2 text-slate-800 shadow-lg";

  function signOut() {
    setOpen(null);
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <div ref={containerRef} className="relative flex items-center gap-1 sm:gap-2">
      <NotificationBell tone={tone} />

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
