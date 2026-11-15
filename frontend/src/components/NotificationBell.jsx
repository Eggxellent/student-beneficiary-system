import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Award, Bell, CheckCheck, CheckCircle2, Clock, FileText, Inbox, XCircle } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

const REFRESH_MS = 60000;
const PAGE_LIMIT = 20;

// One icon and one accent per category, so a decision and a certificate are distinguishable at a
// glance without reading the text.
const CATEGORY_STYLE = {
  award_submitted: { Icon: FileText, tone: "bg-blue-50 text-blue-700" },
  award_pending: { Icon: Clock, tone: "bg-amber-50 text-amber-700" },
  award_approved: { Icon: CheckCircle2, tone: "bg-emerald-50 text-emerald-700" },
  award_rejected: { Icon: XCircle, tone: "bg-rose-50 text-rose-700" },
  certificate_ready: { Icon: Award, tone: "bg-amber-50 text-amber-700" },
};

const FALLBACK_STYLE = { Icon: Bell, tone: "bg-slate-100 text-slate-600" };

function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `KES ${Math.round(amount).toLocaleString("en-KE")}`;
}

function timeAgo(value) {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function NotificationBell({ tone = "light" }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [approvalCount, setApprovalCount] = useState(0);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const containerRef = useRef(null);
  const triggerRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/notifications", { params: { limit: PAGE_LIMIT } });
      setItems(Array.isArray(data?.notifications) ? data.notifications : []);
      setApprovals(Array.isArray(data?.pending_approvals) ? data.pending_approvals : []);
      setApprovalCount(Number(data?.pending_approval_count) || 0);
      setUnread(Number(data?.unread_count) || 0);
      setError("");
    } catch {
      setError("Could not load notifications.");
    } finally {
      setLoading(false);
    }
  }, []);

  // A notification arrives while the officer is working elsewhere, so the list is refreshed on a
  // slow timer and when the tab regains focus, instead of only when the panel is opened.
  useEffect(() => {
    if (!user) return undefined;
    const refresh = () => {
      if (document.visibilityState !== "hidden") load();
    };
    load();
    const timer = setInterval(refresh, REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [load, user]);

  // Opening the panel is the moment the user looks, so it re-reads the list instead of showing
  // whatever the last poll returned.
  useEffect(() => {
    if (open) load();
  }, [load, open]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const dark = tone === "dark";
  const triggerClass = dark
    ? "text-white/80 hover:bg-white/10 hover:text-white"
    : "text-slate-500 hover:bg-slate-100 hover:text-slate-800";
  // The badge counts outstanding work, not messages: an administrator who has opened every
  // notification but left three proposals undecided still needs to see a badge.
  const badge = unread + Math.max(approvalCount, approvals.length);
  const empty = items.length === 0 && approvals.length === 0;

  // Reading a notification consumes it: the API deletes the row, so the panel drops it from the
  // list instead of restyling it, and "clear all" empties the panel. There is no read history to
  // load because nothing read is stored.
  async function clearAll() {
    if (!items.length) return;
    const previousItems = items;
    const previousUnread = unread;
    setItems([]);
    setUnread(0);
    try {
      await api.delete("/notifications");
    } catch {
      setItems(previousItems);
      setUnread(previousUnread);
      setError("Could not clear notifications.");
    }
  }

  async function openNotification(item) {
    setOpen(false);
    // The click deletes the row and then leaves the panel: the destination is the point of the
    // notification, and a notification that has been read has nothing left to show.
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    setUnread((current) => Math.max(0, current - 1));
    api.delete(`/notifications/${item.id}`).catch(() => load());
    if (item.link) navigate(item.link);
  }

  // A waiting student is not a message: the row survives until an administrator decides the award,
  // so the click navigates and deletes nothing.
  function openAwaiting(item) {
    setOpen(false);
    navigate(item.link || "/awards");
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={badge ? `Notifications, ${badge} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#C8A45D] ${triggerClass}`}
      >
        <Bell size={16} aria-hidden="true" />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#C8A45D] px-1 text-[9px] font-bold text-[#173D35]">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 top-full z-40 mt-2 flex w-[21rem] max-w-[calc(100vw-1.5rem)] flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-slate-800 shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notifications</p>
            <button
              type="button"
              onClick={clearAll}
              disabled={!items.length}
              className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-semibold text-[#245747] transition hover:bg-slate-50 disabled:cursor-default disabled:text-slate-300"
            >
              <CheckCheck size={13} aria-hidden="true" /> Clear all
            </button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {approvals.length > 0 && (
              <section aria-label="Students awaiting approval">
                <p className="flex items-center justify-between gap-2 bg-amber-50/70 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                  <span>Students awaiting approval</span>
                  <span>{approvalCount > approvals.length ? approvalCount : approvals.length}</span>
                </p>
                <ul className="divide-y divide-slate-100">
                  {approvals.map((item) => {
                    const { Icon } = CATEGORY_STYLE.award_pending;
                    const amount = formatMoney(item.requested_amount);
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => openAwaiting(item)}
                          title="Open Awards to decide"
                          className="flex w-full items-start gap-2.5 bg-white px-3 py-2.5 text-left transition hover:bg-slate-50"
                        >
                          <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${CATEGORY_STYLE.award_pending.tone}`}>
                            <Icon size={14} aria-hidden="true" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold text-slate-900">
                              {item.student_name}
                            </span>
                            <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                              {amount ? `${amount} requested` : "Proposal awaiting a decision"}
                            </span>
                            <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-slate-400">
                              Waiting since {timeAgo(item.created_at)}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {approvalCount > approvals.length && (
                  <p className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-amber-800">
                    {approvalCount - approvals.length} more waiting in Awards.
                  </p>
                )}
              </section>
            )}
            {loading && empty && (
              <p className="px-3 py-4 text-xs text-slate-500">Loading notifications…</p>
            )}
            {error && <p className="px-3 py-2 text-xs text-red-600">{error}</p>}
            {!loading && empty && !error && (
              <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                <Inbox size={22} className="text-slate-300" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-700">You&apos;re all caught up</p>
                <p className="text-[11px] text-slate-500">
                  Proposals awaiting review, award decisions and ready approval invoices will appear here.
                </p>
              </div>
            )}
            {items.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {items.map((item) => {
                  const style = CATEGORY_STYLE[item.category] || FALLBACK_STYLE;
                  const { Icon } = style;
                  // Every row in this list is still waiting: opening it deletes it.
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => openNotification(item)}
                        className="flex w-full items-start gap-2.5 bg-[#FBF7EC] px-3 py-2.5 text-left transition hover:bg-slate-50"
                      >
                        <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.tone}`}>
                          <Icon size={14} aria-hidden="true" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-slate-900">
                              {item.title}
                            </span>
                            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[#C8A45D]" aria-hidden="true" />
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-slate-500">{item.body}</span>
                          <span className="mt-0.5 block text-[10px] uppercase tracking-wide text-slate-400">
                            {timeAgo(item.created_at)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {items.length >= PAGE_LIMIT && (
            <p className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400">
              Showing the {PAGE_LIMIT} most recent notifications.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
