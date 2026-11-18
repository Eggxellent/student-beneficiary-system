import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, FileSearch, RefreshCw } from "lucide-react";
import api from "../../services/api";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton } from "../../components/ui/primitives";
import { formatDate, screeningSummary, statusMeta } from "../../lib/applicationStatus";

const STATUS_FILTERS = [
  { value: "", label: "All applications" },
  { value: "screened", label: "Screened — awaiting verification" },
  { value: "needs_investigation", label: "Awaiting investigation" },
  { value: "investigated", label: "Awaiting administrator decision" },
  { value: "resolved", label: "Duplicate cleared" },
  { value: "verified", label: "Verified" },
  { value: "award_recommended", label: "Award recommended" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

const PAGE_SIZE = 8;

export default function OfficerApplications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") || "";
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get("/applications", {
        params: statusFilter ? { status: statusFilter } : {},
      });
      setApplications(response.data.applications || []);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load applications.");
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setPage(0);
  }, [statusFilter, query]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return applications;
    return applications.filter((entry) =>
      [entry.full_name, entry.school_code, entry.id]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [applications, query]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const counts = useMemo(
    () => ({
      total: applications.length,
      investigations: applications.filter((entry) => entry.status === "needs_investigation").length,
      ready: applications.filter(
        (entry) => ["screened", "resolved"].includes(entry.status) && !entry.duplicate_of_student_id && !entry.open_cases
      ).length,
    }),
    [applications]
  );

  function changeStatus(value) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("status", value);
    else next.delete("status");
    setSearchParams(next, { replace: true });
  }


  return (
    <div className="sb-stack sb-animate-rise">
      <PageHeader
        eyebrow="Applications"
        title="Applications"
        subtitle="Review guardian-submitted applications, investigate possible duplicates and verify eligibility. Final duplicate and award decisions belong to the administrator."
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      <div className="sb-grid sb-grid--3">
        <div className="sb-stat">
          <span className="sb-stat__label">Shown in this view</span>
          <span className="sb-stat__value">{counts.total}</span>
          <span className="sb-stat__note">Newest first, up to 200</span>
        </div>
        <div className="sb-stat sb-stat--warning">
          <span className="sb-stat__label">Awaiting investigation</span>
          <span className="sb-stat__value">{counts.investigations}</span>
          <span className="sb-stat__note">Possible duplicate cases</span>
        </div>
        <div className="sb-stat sb-stat--success">
          <span className="sb-stat__label">Ready to verify</span>
          <span className="sb-stat__value">{counts.ready}</span>
          <span className="sb-stat__note">Duplicate gate cleared</span>
        </div>
      </div>

      {error && (
        <Alert tone="error" title="Applications unavailable">
          {error}
        </Alert>
      )}

      <Card
        title="Application queue"
        action={
          <div className="sb-row" style={{ gap: 8 }}>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="sb-input"
              style={{ minHeight: 36, width: 220 }}
              placeholder="Search name, school or reference"
              aria-label="Search applications"
            />
            <select
              value={statusFilter}
              onChange={(event) => changeStatus(event.target.value)}
              className="sb-input"
              style={{ minHeight: 36, width: 230 }}
              aria-label="Filter by application status"
            >
              {STATUS_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        }
        footer={
          <div className="sb-row sb-row--between">
            <span className="sb-meta">
              {filtered.length} application{filtered.length === 1 ? "" : "s"} · page {page + 1} of {pageCount}
            </span>
            <div className="sb-row" style={{ gap: 8 }}>
              <Button size="sm" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0}>
                Previous
              </Button>
              <Button
                size="sm"
                onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
                disabled={page >= pageCount - 1}
              >
                Next
              </Button>
            </div>
          </div>
        }
      >
        {loading ? (
          <Skeleton lines={5} />
        ) : visible.length === 0 ? (
          <EmptyState title="No applications match this view" icon={FileSearch}>
            {query
              ? "Try a different search term, or clear the status filter."
              : "Applications appear here after a guardian submits the public form."}
          </EmptyState>
        ) : (
          <div className="sb-table-wrap">
            <table className="sb-table">
              <thead>
                <tr>
                  <th scope="col">Reference</th>
                  <th scope="col">Student</th>
                  <th scope="col">School</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                  <th scope="col">Screening</th>
                  <th scope="col" aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const meta = statusMeta(entry.status);
                  const screening = screeningSummary(entry);
                  return (
                    <tr key={entry.id}>
                      <td>
                        <span className="sb-table__primary sb-code">{String(entry.id).slice(0, 8).toUpperCase()}</span>
                        {entry.open_cases > 0 && <span className="sb-table__sub">{entry.open_cases} open duplicate case(s)</span>}
                      </td>
                      <td>{entry.full_name}</td>
                      <td>{entry.school_code}</td>
                      <td>{formatDate(entry.created_at)}</td>
                      <td>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td>
                        <Badge tone={screening.tone}>{screening.label}</Badge>
                      </td>
                      <td style={{ textAlign: "right" }}>
                        <Link to={`/applications/${entry.id}`} className="sb-link">
                          View
                          <ArrowRight size={14} aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="sb-meta">
        Field Officers record investigation findings and verify eligibility. Rejecting an application or
        approving an award is an administrator decision.
      </p>
    </div>
  );
}
