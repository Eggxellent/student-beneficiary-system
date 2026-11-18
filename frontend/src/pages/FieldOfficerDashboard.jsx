import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, FileText, RefreshCw, ShieldAlert } from "lucide-react";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";
import { Alert, Badge, Button, Card, EmptyState, PageHeader, Skeleton, Stat } from "../components/ui/primitives";
import { formatDate, requiredAction, statusMeta } from "../lib/applicationStatus";

// Every figure below is counted from the two endpoints the officer already has access to
// (`/applications` and `/awards`). Nothing is estimated, and no financial totals are shown.
function countBy(list, predicate) {
  return list.filter(predicate).length;
}

export default function FieldOfficerDashboard() {
  const { user } = useAuth();
  const [applications, setApplications] = useState([]);
  const [awards, setAwards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const [applicationsResponse, awardsResponse] = await Promise.all([api.get("/applications"), api.get("/awards")]);
      setApplications(applicationsResponse.data.applications || []);
      setAwards(awardsResponse.data.awards || []);
    } catch (err) {
      setError(err.response?.data?.message || "Unable to load your workspace.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const summary = useMemo(() => {
    const investigations = countBy(applications, (entry) => entry.status === "needs_investigation");
    const eligibility = countBy(
      applications,
      (entry) =>
        ["screened", "resolved"].includes(entry.status) && !entry.duplicate_of_student_id && !entry.open_cases
    );
    const recommendations = countBy(awards, (award) => award.status === "submitted");
    const approved = countBy(awards, (award) => award.status === "approved");
    return { investigations, eligibility, recommendations, approved };
  }, [applications, awards]);

  const attention = useMemo(
    () =>
      applications
        .filter(
          (entry) =>
            entry.status === "needs_investigation" ||
            (["screened", "resolved"].includes(entry.status) && !entry.duplicate_of_student_id && !entry.open_cases)
        )
        .slice(0, 6),
    [applications]
  );

  const recent = useMemo(
    () =>
      [...applications]
        .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
        .slice(0, 5),
    [applications]
  );

  return (
    <div className="sb-stack sb-animate-rise">
      <PageHeader
        eyebrow="Overview"
        title={`Welcome, ${user?.full_name?.split(" ")[0] || "Field Officer"}`}
        subtitle="Applications that need a Field Officer, based on the recorded status of each application."
        actions={
          <Button onClick={load} disabled={loading}>
            <RefreshCw size={14} aria-hidden="true" />
            Refresh
          </Button>
        }
      />

      {error && (
        <Alert tone="error" title="Workspace unavailable">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="sb-grid sb-grid--4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="sb-card sb-card--pad">
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      ) : (
        <div className="sb-grid sb-grid--4">
          <Stat label="Duplicate investigations pending" value={summary.investigations} note="Awaiting your findings" tone="warning" />
          <Stat label="Eligibility verifications pending" value={summary.eligibility} note="Cleared and ready to verify" />
          <Stat label="Award recommendations" value={summary.recommendations} note="Submitted, awaiting the administrator" />
          <Stat label="Approved awards" value={summary.approved} note="Decided by the administrator" tone="success" />
        </div>
      )}

      <div className="sb-split">
        <Card title="Work requiring attention" action={<Badge tone={attention.length > 0 ? "warning" : "success"}>{attention.length} open</Badge>}>
          {loading ? (
            <Skeleton lines={4} />
          ) : attention.length === 0 ? (
            <EmptyState title="Nothing needs your action" icon={ClipboardCheck}>
              Applications awaiting investigation or verification will appear here.
            </EmptyState>
          ) : (
            <div className="sb-table-wrap">
              <table className="sb-table">
                <thead>
                  <tr>
                    <th scope="col">Application</th>
                    <th scope="col">Status</th>
                    <th scope="col">Required action</th>
                    <th scope="col" aria-label="Open" />
                  </tr>
                </thead>
                <tbody>
                  {attention.map((entry) => {
                    const meta = statusMeta(entry.status);
                    return (
                      <tr key={entry.id}>
                        <td>
                          <span className="sb-table__primary">{entry.full_name}</span>
                          <span className="sb-table__sub">
                            {entry.school_code} · ref {String(entry.id).slice(0, 8).toUpperCase()} · {formatDate(entry.created_at)}
                          </span>
                        </td>
                        <td>
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td>
                          <span className="sb-table__sub" style={{ marginTop: 0 }}>
                            {requiredAction(entry)}
                          </span>
                          {entry.screening_failure_code && (
                            <span className="sb-badge sb-badge--warning" style={{ marginTop: 6 }}>
                              <ShieldAlert size={12} aria-hidden="true" /> Screening not completed
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Link to={`/applications/${entry.id}`} className="sb-link">
                            Open
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

        <div className="sb-stack">
          <Card title="Quick actions">
            <div className="sb-stack sb-stack--tight">
              <Link to="/applications" className="sb-btn sb-btn--block">
                <FileText size={15} aria-hidden="true" />
                Open applications
              </Link>
              <Link to="/applications?status=needs_investigation" className="sb-btn sb-btn--block">
                <ShieldAlert size={15} aria-hidden="true" />
                Continue an investigation
              </Link>
              <Link to="/eligibility" className="sb-btn sb-btn--block">
                <ClipboardCheck size={15} aria-hidden="true" />
                Review eligibility
              </Link>
              <Link to="/awards" className="sb-btn sb-btn--block">
                Award recommendations
              </Link>
            </div>
          </Card>

          <Card title="Recently submitted">
            {loading ? (
              <Skeleton lines={3} />
            ) : recent.length === 0 ? (
              <EmptyState title="No applications yet">Guardian applications will appear here.</EmptyState>
            ) : (
              <ul className="sb-dl" style={{ listStyle: "none", padding: 0, margin: 0 }}>
                {recent.map((entry) => (
                  <li key={entry.id} className="sb-dl__row">
                    <span style={{ minWidth: 0 }}>
                      <Link to={`/applications/${entry.id}`} className="sb-table__primary">
                        {entry.full_name}
                      </Link>
                      <span className="sb-table__sub">{entry.school_code}</span>
                    </span>
                    <Badge tone={statusMeta(entry.status).tone}>{statusMeta(entry.status).label}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

