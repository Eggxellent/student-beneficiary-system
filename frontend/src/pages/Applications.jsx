import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import api from "../services/api";

// Administrator view of the guardian submission queue. The application is the record the guardian
// submitted; the student record it produced is what duplicate screening, eligibility, awards and
// the Field Officer screens use. Both are shown together so a submission can never look "lost"
// simply because its student is waiting on a review.

const STATUS_STYLES = {
  submitted: "border-slate-200 bg-slate-50 text-slate-700",
  under_review: "border-sky-200 bg-sky-50 text-sky-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  rejected: "border-red-200 bg-red-50 text-red-700",
};

const DUPLICATE_STYLES = {
  pending: "border-orange-200 bg-orange-50 text-orange-800",
  needs_verification: "border-amber-200 bg-amber-50 text-amber-800",
  confirmed_duplicate: "border-red-200 bg-red-50 text-red-700",
  not_duplicate: "border-emerald-200 bg-emerald-50 text-emerald-800",
  cleared: "border-emerald-200 bg-emerald-50 text-emerald-800",
  not_screened: "border-slate-200 bg-slate-50 text-slate-600",
};

const DUPLICATE_LABELS = {
  pending: "Under Review",
  needs_verification: "Under Review",
  confirmed_duplicate: "Confirmed Duplicate",
  not_duplicate: "Cleared",
  cleared: "Cleared",
  not_screened: "Not Screened",
};
function label(value) {
  if (!value) return "—";
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortDate(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

function detailRows(detail) {
  if (!detail) return [];
  return [
    ["Date of birth", detail.student?.dateOfBirth],
    ["Gender", detail.student?.gender],
    ["Birth certificate / identifier", detail.student?.identification],
    ["Relationship to student", detail.student?.relationship],
    ["School", detail.school?.name],
    ["Level / class", [detail.school?.level, detail.school?.currentClass].filter(Boolean).join(" · ")],
    ["Admission number", detail.school?.admissionNumber],
    ["County", detail.school?.location],
    ["Guardian on application", detail.household?.guardianName],
    ["Guardian phone", detail.household?.phone],
    ["Guardian National ID", detail.household?.guardianNationalId],
    ["Household", detail.household?.size],
    ["Income source", detail.household?.incomeSource],
    ["Monthly income", detail.household?.monthlyIncome],
  ].filter(([, value]) => value && value !== "—");
}

export default function Applications() {
  const [applications, setApplications] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, totalPages: 1, totalRecords: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const detailsRef = useRef(null);

  async function loadApplications({ nextPage = page, nextPageSize = pageSize, nextQuery = query, nextStatus = statusFilter } = {}) {
    setLoading(true);
    setError("");
    try {
      const requestedPage = Number(nextPage);
      const requestedPageSize = Number(nextPageSize);
      const safePage = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const safePageSize = Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
        ? Math.min(10, requestedPageSize)
        : 10;
      const { data } = await api.get("/guardian/staff/applications", {
        params: {
          page: safePage,
          page_size: safePageSize,
          search: nextQuery,
          status: ["under_review", "approved", "rejected"].includes(nextStatus) ? nextStatus : "",
        },
      });
      const rows = Array.isArray(data?.applications) ? data.applications : [];
      setApplications(rows);
      const responsePage = Number(data?.pagination?.page);
      const resultPage = Number.isSafeInteger(responsePage) && responsePage > 0 ? responsePage : safePage;
      const responsePageSize = Number(data?.pagination?.pageSize);
      const responseTotalPages = Number(data?.pagination?.totalPages);
      const responseTotalRecords = Number(data?.pagination?.totalRecords);
      setPagination({
        page: resultPage,
        pageSize: Number.isSafeInteger(responsePageSize) && responsePageSize > 0 ? responsePageSize : safePageSize,
        totalPages: Number.isSafeInteger(responseTotalPages) && responseTotalPages > 0 ? responseTotalPages : 1,
        totalRecords: Number.isSafeInteger(responseTotalRecords) && responseTotalRecords >= 0 ? responseTotalRecords : rows.length,
      });
      setPage(resultPage);
      setSelectedId((current) =>
        current && rows.some((row) => row.id === current) ? current : null,
      );
    } catch (requestError) {
      const message = requestError.response?.data?.error;
      setError(typeof message === "string" && message.trim() ? message : "Unable to load guardian applications. Please refresh and try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadApplications({ nextPage: page, nextPageSize: pageSize, nextQuery: query, nextStatus: statusFilter });
  }, [page, pageSize, query, statusFilter]);

  const selected = applications.find((application) => application.id === selectedId) || null;

  useEffect(() => {
    if (selectedId) detailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selectedId]);

  function toggleApplicationDetails(application) {
    if (application.id === selectedId) {
      setSelectedId(null);
      return;
    }
    setSelectedId(application.id);
  }



  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Guardian applications</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Review guardian submissions and their linked student records.
          </p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => loadApplications({ nextPage: page, nextPageSize: pageSize, nextQuery: query, nextStatus: statusFilter })}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw size={14} aria-hidden="true" /> Refresh
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={query}
          onChange={(event) => { setQuery(event.target.value); setPage(1); }}
          placeholder="Search reference, student, school or guardian"
          className="w-full rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <select
          value={statusFilter}
          onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }}
          className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700"
        >
          <option value="all">All statuses</option>
          <option value="under_review">Under review</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <span>{pagination.totalRecords} total {pagination.totalRecords === 1 ? "application" : "applications"}</span>
        <label className="flex items-center gap-2">
          Rows per page
          <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }} className="rounded border border-slate-200 bg-white px-2 py-1.5">
            {Array.from({ length: 10 }, (_, index) => index + 1).map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </div>
      <section aria-label="Application results" className="space-y-2">
        {!loading && applications.length > 0 && (
          <p className="text-sm text-slate-500">
            Page {pagination.page} of {pagination.totalPages} · Showing {applications.length} records
          </p>
        )}
        {applications.map((application) => {
          const isSelected = application.id === selectedId;
          return (
            <article
              key={application.id}
              role="button"
              tabIndex={0}
              aria-label={`${isSelected ? "Close" : "Open"} details for ${application.reference}`}
              aria-expanded={isSelected}
              onClick={() => toggleApplicationDetails(application)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  toggleApplicationDetails(application);
                }
              }}
              className={`cursor-pointer rounded-xl border bg-white p-3 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-200 sm:p-4 ${
                isSelected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-slate-300"
              }`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="break-words text-base font-semibold text-slate-900">
                      {application.student || "Student name unavailable"}
                    </h2>
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[application.status_code] || STATUS_STYLES.submitted}`}>
                      {application.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{application.registeredStudent?.school_code || application.school || "School unavailable"}</p>
                </div>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-2 border-t border-slate-100 pt-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Guardian</dt>
                  <dd className="mt-0.5 truncate font-medium text-slate-800" title={application.guardianAccount}>
                    {application.guardianAccount || "Not provided"}
                  </dd>
                  {application.guardianEmail && (
                    <dd className="truncate text-xs text-slate-500" title={application.guardianEmail}>
                      {application.guardianEmail}
                    </dd>
                  )}
                </div>
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Submitted</dt>
                  <dd className="mt-0.5 text-slate-800">{shortDate(application.submitted_at)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Application</dt>
                  <dd className="mt-0.5 break-all font-medium text-slate-800">{application.reference}</dd>
                </div>
              </dl>

              <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                {application.registeredStudent ? (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700">
                    <span className="font-semibold">Student record</span>
                    <span className="truncate">Admission no. {application.registeredStudent.admission_number || "Not captured"}</span>
                  </span>
                ) : (
                  <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700">
                    Student record not linked
                  </span>
                )}
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${DUPLICATE_STYLES[application.duplicate?.status] || DUPLICATE_STYLES.not_screened}`}>
                  Duplicate Screening: {DUPLICATE_LABELS[application.duplicate?.status] || "Not Screened"}
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                  {application.assessment
                    ? `${label(application.assessment.status)} assessment${
                        application.assessment.score === null ? "" : ` · ${application.assessment.score}/100`
                      }`
                    : "No assessment yet"}
                </span>
              {application.assessment?.status === "incomplete" && application.assessment.missing_inputs?.length > 0 && (
                <span className="w-full text-xs text-amber-800">Missing: {application.assessment.missing_inputs.map(label).join(", ")}</span>
              )}
              </div>
            </article>
          );
        })}
        {!loading && applications.length === 0 && (
          <p className="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-slate-500">
            No guardian applications match this filter.
          </p>
        )}
        {loading && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-10 text-center text-slate-500">
            Loading applications...
          </p>
        )}
      </section>

      <nav aria-label="Application pages" className="mt-4 flex items-center justify-between gap-3">
        <button type="button" disabled={loading || pagination.page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50">Previous</button>
        <span className="text-sm text-slate-600">Page {pagination.page} of {pagination.totalPages}</span>
        <button type="button" disabled={loading || pagination.page >= pagination.totalPages} onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))} className="rounded border border-slate-200 bg-white px-3 py-2 text-sm disabled:opacity-50">Next</button>
      </nav>

      {selected && (
        <section ref={detailsRef} className="mt-6 scroll-mt-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{selected.reference}</h2>
              <p className="mt-1 text-sm text-slate-600">
                {selected.detail?.student?.name} · {selected.detail?.school?.name}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {selected.registeredStudent && (
                <Link
                  to={`/duplicate-review?student=${selected.registeredStudent.id}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"
                >
                  Duplicate review <ExternalLink size={13} aria-hidden="true" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>

          {!selected.registeredStudent && (
            <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
              No student record is linked to this application yet. Contact system support to restore it.
            </p>
          )}

          <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {detailRows(selected.detail).map(([name, value]) => (
              <div key={name} className="flex justify-between gap-3 border-b border-slate-100 pb-1">
                <dt className="text-slate-500">{name}</dt>
                <dd className="text-right font-medium text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>

          <p className="mt-5 border-t border-slate-100 pt-4 text-sm text-slate-600">
            {selected.status_code === "under_review"
              ? "Waiting for Admin duplicate review."
              : selected.status_code === "rejected"
                ? "Rejected after duplicate review. This application is locked."
                : selected.status_code === "approved"
                  ? "Approved automatically after duplicate screening cleared. Eligibility assessment is handled separately."
                  : "Application status is updated automatically by duplicate screening."}
          </p>
        </section>
      )}
    </main>
  );
}


