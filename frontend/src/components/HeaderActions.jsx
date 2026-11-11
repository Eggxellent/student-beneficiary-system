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

const NOTIFICATION_LIMIT = 8;

function money(value) {
  return `KSh ${Number(value || 0).toLocaleString()}`;
}

// Duplicate flags keep their raw id as the seen key so flags already marked as read before this
// change stay read. Proposals are namespaced because both lists share one seen store.
function proposalKey(award) {
  return `award:${award?.id}`;
}

function proposalState(award) {
  return award?.verification_status === "verified"
    ? { label: "Ready for your decision", tone: "bg-emerald-50 text-emerald-700" }
    : { label: "Verification still pending", tone: "bg-amber-50 text-amber-700" };
}

function seenStorageKey(user) {
  return `sbms:duplicate-notifications:seen:${user?.id || user?.email || "anonymous"}`;
}

function readSeenIds(user) {
  try {
    const parsed = JSON.parse(localStorage.getItem(seenStorageKey(user)));
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function persistSeenIds(user, ids) {
  try {
    localStorage.setItem(seenStorageKey(user), JSON.stringify([...ids].slice(-200)));
  } catch {
    /* storage unavailable */
  }
}

export default function HeaderActions({ tone = "light" }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [notificationsError, setNotificationsError] = useState("");
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [seenIds, setSeenIds] = useState(() => readSeenIds(user));
  const [proposals, setProposals] = useState([]);
  const [proposalTotal, setProposalTotal] = useState(0);
  const [proposalsError, setProposalsError] = useState("");
  const [loadingProposals, setLoadingProposals] = useState(false);
  const [proposerNames, setProposerNames] = useState({});
  const containerRef = useRef(null);

  const isAdmin = user?.role === "admin";
  const unreadCount =
    notifications.filter((item) => !seenIds.has(item.id)).length +
    proposals.filter((award) => !seenIds.has(proposalKey(award))).length;

  useEffect(() => {
    if (!isAdmin) return undefined;
    let active = true;
    setLoadingNotifications(true);
    setLoadingProposals(true);
    api.get("/duplicate-flags", { params: { status: "open", page: 1, page_size: NOTIFICATION_LIMIT } })
      .then(({ data }) => {
        if (!active) return;
        setNotifications(Array.isArray(data?.cases) ? data.cases : []);
        setNotificationsError("");
      })
      .catch(() => { if (active) setNotificationsError("Could not load duplicate flags."); })
      .finally(() => { if (active) setLoadingNotifications(false); });
    // Awards already proposed by field officers and not yet decided by an administrator. Oldest
    // first, because the longest wait is the one that needs attention.
    api.get("/awards")
      .then(({ data }) => {
        if (!active) return;
        const awaiting = (Array.isArray(data?.awards) ? data.awards : [])
          .filter((award) => award.status === "submitted")
          .sort((left, right) => new Date(left.created_at || 0) - new Date(right.created_at || 0));
        setProposals(awaiting.slice(0, NOTIFICATION_LIMIT));
        setProposalTotal(awaiting.length);
        setProposalsError("");
      })
      .catch(() => { if (active) setProposalsError("Could not load bursary decisions awaiting you."); })
      .finally(() => { if (active) setLoadingProposals(false); });
    // Proposer names only decorate the proposal lines; a failure here leaves them anonymous.
    api.get("/users")
      .then(({ data }) => {
        if (!active || !Array.isArray(data)) return;
        setProposerNames(Object.fromEntries(data.map((entry) => [entry.id, entry.full_name || entry.email])));
      })
      .catch(() => {});
    return () => { active = false; };
  }, [isAdmin]);

  useEffect(() => {
    if (open !== "alerts" || !isAdmin) return;
    if (notifications.length === 0 && proposals.length === 0) return;
    const unseenFlags = notifications.filter((item) => !seenIds.has(item.id)).map((item) => String(item.id));
    const unseenProposals = proposals.filter((award) => !seenIds.has(proposalKey(award))).map(proposalKey);
    const unseen = [...unseenFlags, ...unseenProposals];
    if (unseen.length === 0) return;
    const next = new Set(seenIds);
    unseen.forEach((key) => next.add(key));
    setSeenIds(next);
    persistSeenIds(user, next);
  }, [open, isAdmin, notifications, proposals, seenIds, user]);

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
            aria-label={unreadCount ? `${unreadCount} new notifications` : "Notifications"}
            aria-haspopup="true"
            aria-expanded={open === "alerts"}
            onClick={() => setOpen(open === "alerts" ? null : "alerts")}
            className={`relative flex h-8 w-8 items-center justify-center rounded-full transition ${triggerClass}`}
          >
            <Bell size={16} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute right-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-[#C8A45D] px-1 text-[9px] font-bold text-[#173D35]">
                {unreadCount}
              </span>
            )}
          </button>
          {open === "alerts" && (
            <div className={`${panelClass} max-h-[70vh] overflow-y-auto`} role="dialog" aria-label="Notifications">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Bursary decisions awaiting you{proposalTotal ? ` (${proposalTotal})` : ""}
              </p>
              {proposalsError && <p className="px-2 py-2 text-xs text-red-600">{proposalsError}</p>}
              {!proposalsError && loadingProposals && <p className="px-2 py-2 text-xs text-slate-500">Loading proposals...</p>}
              {!proposalsError && !loadingProposals && proposals.length === 0 && (
                <p className="px-2 py-2 text-xs text-slate-500">No award proposed by a field officer is waiting for your decision.</p>
              )}
              {proposals.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {proposals.map((award) => {
                    const state = proposalState(award);
                    const key = proposalKey(award);
                    const proposer = proposerNames[award.submitted_by];
                    return (
                      <li key={award.id}>
                        <button
                          type="button"
                          onClick={() => { setOpen(null); navigate("/awards"); }}
                          className="w-full px-2 py-2 text-left transition hover:bg-slate-50"
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-medium text-slate-800">
                              {award.student_name || "Unknown student"}
                            </span>
                            {!seenIds.has(key) && (
                              <span className="shrink-0 rounded bg-[#C8A45D]/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#7a5c1d]">New</span>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            {award.upi || award.school_code || "No UPI"} &middot; {money(award.requested_amount)}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-slate-500">
                            Proposed by {proposer || "a field officer"}{timeAgo(award.created_at) ? ` ${timeAgo(award.created_at)}` : ""}
                          </span>
                          <span className={`mt-1 inline-flex rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${state.tone}`}>
                            {state.label}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {proposalTotal > proposals.length && (
                <p className="px-2 py-1 text-[11px] text-slate-500">
                  {proposalTotal - proposals.length} more proposal{proposalTotal - proposals.length === 1 ? "" : "s"} also await a decision.
                </p>
              )}
              <button
                type="button"
                onClick={() => { setOpen(null); navigate("/awards"); }}
                className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-[#245747] hover:bg-slate-50"
              >
                Open Awards to decide
              </button>
              <div className="my-1 border-t border-slate-100" />
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Duplicate detection{notifications.length ? ` (${notifications.length})` : ""}
              </p>
              {notificationsError && <p className="px-2 py-2 text-xs text-red-600">{notificationsError}</p>}
              {!notificationsError && loadingNotifications && notifications.length === 0 && <p className="px-2 py-2 text-xs text-slate-500">Loading flags…</p>}
              {!notificationsError && !loadingNotifications && notifications.length === 0 && (
                <p className="px-2 py-2 text-xs text-slate-500">No duplicate flags awaiting review.</p>
              )}
              <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
                {notifications.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => { setOpen(null); navigate("/duplicate-review"); }}
                      className="w-full px-2 py-2 text-left transition hover:bg-slate-50"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-slate-800">
                          {entry.students?.[0]?.full_name || "Unknown"} / {entry.students?.[1]?.full_name || "Unknown"}
                        </span>
                        {!seenIds.has(entry.id) && (
                          <span className="shrink-0 rounded bg-[#C8A45D]/20 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#7a5c1d]">New</span>
                        )}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {entry.priority === "high" ? "High · " : ""}{timeAgo(entry.created_at)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => { setOpen(null); navigate("/duplicate-review"); }}
                className="mt-1 w-full rounded px-2 py-1.5 text-left text-xs font-semibold text-[#245747] hover:bg-slate-50"
              >
                Open Duplicate Review
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
