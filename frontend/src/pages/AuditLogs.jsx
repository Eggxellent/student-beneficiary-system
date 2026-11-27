import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import api from "../services/api";

const actionLabels = {
  CREATE: "Student registered",
  GUARDIAN_REGISTERED: "Guardian account created",
  GUARDIAN_PROFILE_UPDATED: "Guardian profile updated",
  GUARDIAN_APPLICATION_SUBMITTED: "Application submitted",
  GUARDIAN_APPLICATION_DECIDED: "Application decision recorded",
  GUARDIAN_APPLICATION_LINKED_STUDENT: "Student record linked",
  GUARDIAN_APPLICATION_AUTO_APPROVED: "Application cleared",
  GUARDIAN_APPLICATION_REJECTED_DUPLICATE: "Duplicate application rejected",
  GUARDIAN_APPLICATION_DUPLICATE_RESCREEN_FLAGGED: "Duplicate review opened",
  DUPLICATE_CONFIRMED_DUPLICATE: "Duplicate confirmed",
  DUPLICATE_NOT_DUPLICATE: "Cleared as not duplicate",
  DUPLICATE_NEEDS_VERIFICATION: "More review requested",
  DUPLICATE_CASE_RESOLVED: "Duplicate case resolved",
  AWARD_SUBMITTED: "Bursary award submitted",
  AWARD_APPROVED: "Bursary award approved",
  AWARD_REJECTED: "Bursary award rejected",
  AWARD_ERROR_REPORTED: "Award issue reported",
  AWARD_CORRECTED: "Award corrected",
  AWARD_VOIDED: "Award cancelled",
  AWARD_CERTIFICATE_ISSUED: "Award invoice issued",
  SCAN_DUPLICATES: "Duplicate screening run",
  REVEAL_DUPLICATE_IDENTIFIERS: "Duplicate details revealed",
  ELIGIBILITY_CALCULATED: "Eligibility assessed",
  ELIGIBILITY_ASSESSMENT_INCOMPLETE: "Eligibility incomplete",
  ELIGIBILITY_INPUTS_CORRECTED: "Eligibility details corrected",
  GENERATE_REPORT: "Report generated",
  ADMIN_UPDATE_DUPLICATE_THRESHOLDS: "Duplicate thresholds changed",
  ADMIN_ISSUE_PASSWORD_RESET: "Password reset link issued",
  ADMIN_CREATE_USER: "User account created",
  ADMIN_CHANGE_USER_ROLE: "User access changed",
  ADMIN_DEACTIVATE_USER: "User deactivated",
  USER_PASSWORD_RESET: "Password changed with reset link",
};

const resourceLabels = {
  students: "Student record",
  bursary_awards: "Bursary award",
  bursary_certificates: "Award invoice",
  duplicate_flags: "Duplicate review case",
  system_settings: "System settings",
  reports: "Report",
  users: "User account",
  disbursements: "Disbursement",
  guardian_applications: "Guardian application",
};

const detailLabels = {
  requested_amount: "Requested amount",
  approved_amount: "Approved amount",
  school_code: "School code",
  outcome: "Verification outcome",
  evidence_ref: "Evidence reference",
  reason: "Decision reason",
  award_id: "Award",
  certificate_reference: "Invoice number",
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
  reference: "Reference",
  assessment_status: "Assessment status",
  duplicate_flags_created: "Duplicate flags",
  registration_source: "Registration source",
  guardian_application_id: "Application record",
  duplicate_candidates_considered: "Candidates checked",
  duplicate_candidates_near_match: "Near matches",
  duplicate_candidates_qualifying: "Candidates flagged",
  duplicate_candidates_suppressed: "Candidates withheld",
  duplicate_candidates_guardian_only: "Guardian-only matches",
  action: "Action",
};

const emptyFilters = { search: "", category: "all", resource: "all", from: "", to: "" };
const pageSizes = [25, 50, 100];

function humanize(value) {
  if (!value) return "—";
  const text = String(value).replaceAll("_", " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function actionLabel(action, details) {
  if (action === "CREATE" && details?.registration_source === "guardian_application") return "Student record created";
  return actionLabels[action] || humanize(action);
}

function resourceLabel(table) {
  if (!table) return "Unlinked record";
  return resourceLabels[table] || humanize(table);
}

function detailLabel(key) {
  return detailLabels[key] || humanize(key);
}

function eventCategory(log) {
  const action = String(log.action || "");
  if (action === "GUARDIAN_APPLICATION_DUPLICATE_RESCREEN_FLAGGED") return "Duplicate review";
  if (action.startsWith("GUARDIAN_APPLICATION_")) return "Applications";
  if (action === "GUARDIAN_REGISTERED" || action === "GUARDIAN_PROFILE_UPDATED") return "Guardian accounts";
  if (action.startsWith("DUPLICATE_") || ["SCAN_DUPLICATES", "REVEAL_DUPLICATE_IDENTIFIERS", "ADMIN_UPDATE_DUPLICATE_THRESHOLDS"].includes(action)) return "Duplicate review";
  if (action.startsWith("ELIGIBILITY_")) return "Eligibility";
  if (action.startsWith("AWARD_")) return "Bursary";
  if (action === "GENERATE_REPORT") return "Reports";
  if (action.startsWith("ADMIN_") || action.startsWith("USER_")) return "User access";
  if (action === "CREATE" || log.table_name === "students") return "Student records";
  const resource = log.table_name;
  if (resource === "guardian_applications") return "Applications";
  if (["bursary_awards", "bursary_certificates", "disbursements"].includes(resource)) return "Bursary";
  if (resource === "duplicate_flags" || resource === "system_settings") return "Duplicate review";
  if (resource === "reports") return "Reports";
  if (resource === "users") return "User access";
  return "Other events";
}

// The collapsed card shows only a short operational summary; the full captured JSON stays
// available inside the event for audit use.
function previewDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return "No additional details";
  const preferred = ["reference", "decision", "status", "assessment_status", "duplicate_flags_created", "score", "model_score", "category", "requested_amount", "approved_amount", "award_id", "certificate_reference", "outcome", "reason"];
  const entries = Object.entries(details).filter(([key, value]) => value !== null && value !== undefined && value !== "");
  const selected = preferred.flatMap((key) => entries.filter(([entryKey]) => entryKey === key)).slice(0, 2);
  if (!selected.length) return entries.length ? `${entries.length} captured value${entries.length === 1 ? "" : "s"}` : "No additional details";
  return selected.map(([key, value]) => `${detailLabel(key)}: ${formatValue(key, value)}`).join(" · ");
}

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
  return value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";
}

function formatDay(value) {
  return value
    ? new Date(value).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short", year: "numeric" })
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

  // Filters only offer categories and records present in the current audit trail.
  const categoryOptions = useMemo(
    () => Array.from(new Set(logs.map(eventCategory))).sort(),
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
      if (filters.category !== "all" && eventCategory(log) !== filters.category) return false;
      if (filters.resource !== "all" && log.table_name !== filters.resource) return false;
      const recordedAt = new Date(log.created_at).getTime();
      if (from !== null && !(recordedAt >= from)) return false;
      if (to !== null && !(recordedAt <= to)) return false;
      if (!term) return true;
      return [
        actionLabel(log.action, log.details),
        log.action,
        eventCategory(log),
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
        <h1 className="text-2xl font-bold text-slate-900">Audit log</h1>
        <p className="mt-1 text-sm text-slate-600">Actions and decisions, newest first.</p>
      </header>

      <section className="mt-4 grid gap-2 rounded border border-slate-200 bg-white p-3 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filter audit events">
        <label className="relative text-xs font-medium text-slate-600 sm:col-span-2">
          Search person, action, record or value
          <Search size={14} className="absolute left-2 top-8 text-slate-400" aria-hidden="true" />
          <input
            name="search"
            value={filters.search}
            onChange={updateFilter}
            placeholder="Name, action, email or reference"
            className="mt-1 h-9 w-full border border-slate-300 pl-7 pr-2 text-sm"
          />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Event type
          <select name="category" value={filters.category} onChange={updateFilter} className="mt-1 h-9 w-full border border-slate-300 px-2 text-sm">
            <option value="all">All event types</option>
            {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
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
          Showing {visible.length} of {filtered.length} events
          {filtered.length !== logs.length ? ` · ${logs.length} total` : ""}
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
              : "No event matches these filters. Clear filters to view the full log."}
          </p>
        </div>
      )}

      {!loading && !error && groups.map((group) => (
        <section key={group.key} className="mt-3 overflow-hidden rounded border border-slate-200 bg-white">
          <h2 className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 px-4 py-2">
            <span className="text-sm font-semibold text-slate-800">{formatDay(group.date)}</span>
            <span className="text-xs text-slate-500">{group.entries.length} event{group.entries.length === 1 ? "" : "s"}</span>
          </h2>
          <div className="divide-y divide-slate-100">
            {group.entries.map((log) => (
              <details key={log.id} className="group px-3 py-2 sm:px-4">
                <summary className="flex cursor-pointer list-none items-center gap-3 rounded px-1 py-1 marker:hidden hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#173D35] [&::-webkit-details-marker]:hidden">
                  <time dateTime={log.created_at} className="w-[4.75rem] shrink-0 text-xs tabular-nums text-slate-500">{formatTime(log.created_at)}</time>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-medium text-slate-900">{actionLabel(log.action, log.details)}</span>
                      <span className="text-xs text-slate-500">{log.user_name || "System"} · {resourceLabel(log.table_name)}</span>
                    </span>
                    <span className="block truncate text-xs text-slate-500">{previewDetails(log.details)}</span>
                  </span>
                  <ChevronDown size={16} className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
                </summary>
                <div className="ml-[4.75rem] mt-2 rounded bg-slate-50 p-3 text-xs sm:ml-[5.5rem]">
                  <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-slate-600">
                    <span>{log.user_email || "System event"}</span>
                    <span>{resourceLabel(log.table_name)} · {log.record_id || "No record ID"}</span>
                    <span className="font-mono">{log.action}</span>
                  </div>
                  <DetailList details={log.details} />
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      {!loading && !error && visible.length > 0 && (
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Audit entries are permanent. Times use this device's time zone.
        </p>
      )}
    </main>
  );
}

function DetailList({ details }) {
  const entries = details && typeof details === "object" && !Array.isArray(details) ? Object.entries(details) : [];
  if (entries.length === 0) return <p className="text-xs text-slate-400">No values captured</p>;

  return (
    <dl className="grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
      {entries.map(([key, value]) => (
        <div key={key} className="min-w-0">
          <dt className="font-medium text-slate-500">{detailLabel(key)}</dt>
          <dd className="break-words text-slate-700">{formatValue(key, value)}</dd>
        </div>
      ))}
    </dl>
  );
}
