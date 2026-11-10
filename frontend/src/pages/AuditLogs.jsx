import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import api from "../services/api";

// The audit trail is the evidence page, so every row shows the readable label and keeps the raw
// action code and table name underneath it. An operator can quote the exact event to an auditor
// without losing either the plain-English meaning or the stored jargon.
const actionLabels = {
  CREATE: "Student registered",
  AWARD_SUBMITTED: "Bursary award submitted",
  AWARD_APPROVED: "Bursary award approved",
  AWARD_REJECTED: "Bursary award rejected",
  AWARD_VERIFICATION_RECORDED: "Award verification recorded",
  AWARD_CERTIFICATE_ISSUED: "Award certificate issued",
  SCAN_DUPLICATES: "Duplicate screening run",
  REVEAL_DUPLICATE_IDENTIFIERS: "Duplicate identifiers revealed",
  ELIGIBILITY_CALCULATED: "Eligibility assessed",
  GENERATE_REPORT: "Report generated",
  ADMIN_UPDATE_DUPLICATE_THRESHOLDS: "Duplicate thresholds changed",
};

const resourceLabels = {
  students: "Student record",
  bursary_awards: "Bursary award",
  bursary_certificates: "Bursary certificate",
  duplicate_flags: "Duplicate review case",
  system_settings: "System settings",
  reports: "Report",
  users: "User account",
  disbursements: "Disbursement",
};

const detailLabels = {
  requested_amount: "Requested amount",
  approved_amount: "Approved amount",
  school_code: "School code",
  outcome: "Verification outcome",
  evidence_ref: "Evidence reference",
  reason: "Decision reason",
  award_id: "Award",
  certificate_reference: "Certificate reference",
  award_period: "Academic year",
  model_version: "Model version",
  review_threshold: "Review threshold",
  candidates_scored: "Candidates scored",
  student_ids: "Students compared",
  fields: "Fields revealed",
  purpose: "Purpose",
  score: "Score",
  category: "Eligibility band",
  recommended_range: "Recommended range",
  from: "Previous values",
  to: "New values",
  duplicate_model_version: "Duplicate model version",
  duplicate_review_threshold: "Duplicate review threshold",
  duplicate_aggregation_policy: "Aggregation policy",
};

const emptyFilters = { search: "", action: "all", resource: "all", from: "", to: "" };
const pageSizes = [25, 50, 100];

function humanize(value) {
  if (!value) return "—";
  const text = String(value).replaceAll("_", " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function actionLabel(action) {
  return actionLabels[action] || humanize(action);
}

function resourceLabel(table) {
  if (!table) return "Unlinked record";
  return resourceLabels[table] || humanize(table);
}

function detailLabel(key) {
  return detailLabels[key] || humanize(key);
}

// Details are stored as JSONB and the shape differs per action: amounts, arrays of identifiers,
// or before/after objects for threshold changes. Every value is rendered in full, so nothing the
// system captured is hidden behind a collapsed JSON blob.
function formatValue(key, value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    if (key.endsWith("_amount")) return `KSh ${value.toLocaleString()}`;
    return Number.isInteger(value) ? String(value) : value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((item) => formatValue(key, item)).join(", ");
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length === 0) return "—";
    return entries.map(([childKey, childValue]) => `${detailLabel(childKey)}: ${formatValue(childKey, childValue)}`).join("; ");
  }
  return String(value);
}

function formatTime(value) {
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

function formatDay(value) {
  return value
    ? new Date(value).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "Unknown date";
}

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export default function AuditLogs() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    api.get("/audit-logs")
      .then((response) => {
        setError("");
        setLogs(Array.isArray(response.data) ? response.data : response.data?.value || []);
      })
      .catch((requestError) => setError(requestError.response?.data?.message || "Unable to load audit logs."))
      .finally(() => setLoading(false));
  }, []);

  const updateFilter = (event) => {
    const { name, value } = event.target;
    setFilters((current) => ({ ...current, [name]: value }));
  };

  // Options come from the loaded trail, so the menus never offer an action or record type that
  // has no matching event.
  const actionOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.action).filter(Boolean))).sort((a, b) => actionLabel(a).localeCompare(actionLabel(b))),
    [logs]
  );
  const resourceOptions = useMemo(
    () => Array.from(new Set(logs.map((log) => log.table_name).filter(Boolean))).sort((a, b) => resourceLabel(a).localeCompare(resourceLabel(b))),
    [logs]
  );

  const filtered = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : null;
    const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : null;

    return logs.filter((log) => {
      if (filters.action !== "all" && log.action !== filters.action) return false;
      if (filters.resource !== "all" && log.table_name !== filters.resource) return false;
      const recordedAt = new Date(log.created_at).getTime();
      if (from !== null && !(recordedAt >= from)) return false;
      if (to !== null && !(recordedAt <= to)) return false;
      if (!term) return true;
      return [
        actionLabel(log.action),
        log.action,
        resourceLabel(log.table_name),
        log.table_name,
        log.record_id,
        log.user_name,
        log.user_email,
        log.details ? JSON.stringify(log.details) : "",
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [logs, filters]);

  const visible = useMemo(() => filtered.slice(0, pageSize), [filtered, pageSize]);

  const summary = useMemo(() => {
    const actors = new Set();
    const actionCounts = new Map();
    const times = [];

    logs.forEach((log) => {
      actors.add(log.user_email || log.user_name || "system");
      actionCounts.set(log.action, (actionCounts.get(log.action) || 0) + 1);
      const recordedAt = new Date(log.created_at).getTime();
      if (Number.isFinite(recordedAt)) times.push(recordedAt);
    });

    const [topAction, topCount] = Array.from(actionCounts.entries()).sort((a, b) => b[1] - a[1])[0] || [];

    return {
      total: logs.length,
      actors: actors.size,
      actionTypes: actionCounts.size,
      topLabel: topAction ? actionLabel(topAction) : "—",
      topCount: topAction ? `${topCount} of ${logs.length} events` : "no events recorded",
      first: times.length ? formatDay(Math.min(...times)) : "—",
      last: times.length ? formatDay(Math.max(...times)) : "—",
    };
  }, [logs]);

  // One block per calendar day, in the order the API returned them, so a long trail reads as a
  // dated sequence of sessions instead of one undifferentiated wall of rows.
  const groups = useMemo(() => {
    const result = [];
    visible.forEach((log) => {
      const key = dayKey(log.created_at);
      const current = result[result.length - 1];
      if (current && current.key === key) current.entries.push(log);
      else result.push({ key, date: log.created_at, entries: [log] });
    });
    return result;
  }, [visible]);

  return (
    <main className="mx-auto max-w-7xl p-5 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Audit Report</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
          Every state change SBMS has recorded, newest first. Each entry keeps the person, the action, the
          record touched and the values captured at the time, so any decision can be traced later without
          relying on memory.
        </p>
      </header>

      <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Audit summary">
        <SummaryCard label="Events recorded" value={summary.total} hint={`${filtered.length} match the filters`} />
        <SummaryCard label="People involved" value={summary.actors} hint="Accounts, plus unauthenticated system events" />
        <SummaryCard label="Most frequent action" value={summary.topLabel} hint={summary.topCount} />
        <SummaryCard label="Action types" value={summary.actionTypes} hint={`${summary.first} to ${summary.last}`} />
      </section>

      <section className="mt-5 grid gap-3 rounded border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter audit events">
        <label className="relative text-xs font-medium text-slate-600 sm:col-span-2">
          Search person, action, record or value
          <Search size={14} className="absolute left-2 top-8 text-slate-400" aria-hidden="true" />
          <input
            name="search"
            value={filters.search}
            onChange={updateFilter}
            placeholder="e.g. approved, admin@sbms, 4f1a"
            className="mt-1 h-9 w-full border border-slate-300 pl-7 pr-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Action
          <select name="action" value={filters.action} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm">
            <option value="all">All actions</option>
            {actionOptions.map((action) => <option key={action} value={action}>{actionLabel(action)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          Record type
          <select name="resource" value={filters.resource} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm">
            <option value="all">All record types</option>
            {resourceOptions.map((table) => <option key={table} value={table}>{resourceLabel(table)}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">
          From
          <input type="date" name="from" value={filters.from} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm" />
        </label>
        <label className="text-xs font-medium text-slate-600">
          To
          <input type="date" name="to" value={filters.to} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm" />
        </label>
      </section>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-slate-500" role="status">
          Showing {visible.length} of {filtered.length} matching events
          {filtered.length !== logs.length ? ` (${logs.length} recorded)` : ""}. Newest first.
        </p>
        <div className="flex items-center gap-3">
          <label className="text-xs font-medium text-slate-600">
            Rows
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="ml-2 h-8 border border-slate-300 px-2 text-sm">
              {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          <button
            type="button"
            onClick={() => setFilters(emptyFilters)}
            className="h-8 border border-slate-300 px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear filters
          </button>
        </div>
      </div>

      {loading && <p className="py-10 text-center text-sm text-slate-500">Loading audit events…</p>}

      {!loading && error && (
        <p className="mt-5 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{error}</p>
      )}

      {!loading && !error && visible.length === 0 && (
        <div className="mt-5 rounded border border-slate-200 bg-white px-5 py-10 text-center">
          <h2 className="font-semibold text-slate-800">Nothing matches these filters</h2>
          <p className="mt-1 text-sm text-slate-600">
            {logs.length === 0
              ? "SBMS has not recorded any audited events yet."
              : "No event matches this search, action, record type or date range. Clear the filters to read the full trail."}
          </p>
        </div>
      )}

      {!loading && !error && groups.map((group) => (
        <section key={group.key} className="mt-6 overflow-hidden rounded border border-slate-200 bg-white shadow-sm">
          <h2 className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2">
            <span className="text-sm font-semibold text-slate-800">{formatDay(group.date)}</span>
            <span className="text-xs text-slate-500">{group.entries.length} event{group.entries.length === 1 ? "" : "s"}</span>
          </h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-y border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Time</th>
                  <th scope="col" className="px-4 py-2 font-medium">Who</th>
                  <th scope="col" className="px-4 py-2 font-medium">Action</th>
                  <th scope="col" className="px-4 py-2 font-medium">Record</th>
                  <th scope="col" className="px-4 py-2 font-medium">Captured values</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {group.entries.map((log) => (
                  <tr key={log.id} className="align-top text-slate-700">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      <time dateTime={log.created_at}>{formatTime(log.created_at)}</time>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{log.user_name || "System"}</p>
                      <p className="text-xs text-slate-500">{log.user_email || "no signed-in account"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{actionLabel(log.action)}</p>
                      <p className="font-mono text-[11px] text-slate-500">{log.action}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-slate-800">{resourceLabel(log.table_name)}</p>
                      <p className="break-all font-mono text-[11px] text-slate-500">{log.record_id || "no record id"}</p>
                    </td>
                    <td className="px-4 py-3"><DetailList details={log.details} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {!loading && !error && visible.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Audit entries are append-only: SBMS records what happened and does not rewrite or delete past
          events. Times are shown in this device's time zone.
        </p>
      )}
    </main>
  );
}

function SummaryCard({ label, value, hint }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold leading-snug text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs leading-relaxed text-slate-500">{hint}</p>}
    </div>
  );
}

// One line per captured field, labelled and readable, instead of a single run-on string. Nulls and
// empty collections still appear so an auditor can see that a field was captured but blank.
function DetailList({ details }) {
  const entries = details && typeof details === "object" && !Array.isArray(details) ? Object.entries(details) : [];
  if (entries.length === 0) return <p className="text-xs text-slate-400">No values captured</p>;

  return (
    <ul className="space-y-0.5 text-xs">
      {entries.map(([key, value]) => (
        <li key={key} className="break-words">
          <span className="font-medium text-slate-500">{detailLabel(key)}:</span>{" "}
          <span className="text-slate-700">{formatValue(key, value)}</span>
        </li>
      ))}
    </ul>
  );
}
