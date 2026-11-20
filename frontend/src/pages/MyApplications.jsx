import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CircleCheck,
  Clock3,
  FileSearch,
  Files,
  LockKeyhole,
  Plus,
  Search,
  Send,
} from "lucide-react";

import {
  GUARDIAN_PATHS,
  GuardianFooter,
  GuardianHeader,
  guardianSectionNav,
} from "../components/GuardianChrome";
import { useAuth } from "../context/AuthContext";
import { fetchGuardianApplications, apiErrorMessage } from "../services/guardian";

// Guardian application list. Rows come from GET /api/guardian/applications (already scoped to the
// signed-in guardian), and the search, status filter and summary counts work on that live data.

const NAV_ITEMS = guardianSectionNav("applications");

const STATUS_STYLES = {
  submitted: "border-border bg-muted text-muted-foreground",
  review: "border-secondary/30 bg-accent text-accent-foreground",
  approved: "border-primary/25 bg-primary/10 text-primary",
  rejected: "border-destructive/30 bg-destructive/10 text-destructive",
};

const CARD_CLASS = "rounded-xl border border-border bg-card shadow-sm";
const CONTROL_CLASS =
  "h-11 rounded-md border border-input bg-card text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-secondary focus:ring-2 focus:ring-ring/30";

function StatusBadge({ status, statusKey }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium ${
        STATUS_STYLES[statusKey] || "border-border bg-muted text-muted-foreground"
      }`}
    >
      {status}
    </span>
  );
}

function SummaryCard({ label, count, description, icon: Icon }) {
  return (
    <div className={`${CARD_CLASS} p-5`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{count}</p>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

function ApplicationCard({ application, onView }) {
  return (
    <article className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs font-medium text-secondary">{application.reference}</p>
          <h3 className="mt-2 text-sm font-semibold text-foreground">{application.student}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {application.school} · {application.date}
          </p>
        </div>
        <StatusBadge status={application.status} statusKey={application.statusKey} />
      </div>

      <button
        type="button"
        onClick={() => onView(application)}
        className="mt-4 text-sm font-medium text-primary hover:underline"
      >
        View Application
      </button>
    </article>
  );
}

export default function MyApplications() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [applications, setApplications] = useState([]);
  const [error, setError] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    let active = true;
    fetchGuardianApplications()
      .then((rows) => { if (active) setApplications(rows); })
      .catch((err) => { if (active) setError(apiErrorMessage(err, "Could not load your applications.")); });
    return () => { active = false; };
  }, []);

  const guardianName = user?.full_name || "Guardian";
  const initials = guardianName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  const filteredApplications = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return applications.filter((application) => {
      const matchesSearch =
        !query ||
        application.student.toLowerCase().includes(query) ||
        application.reference.toLowerCase().includes(query);

      const matchesStatus = statusFilter === "all" || application.statusKey === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [applications, searchTerm, statusFilter]);

  const submittedCount = applications.filter(
    (application) => application.statusKey === "submitted",
  ).length;

  const reviewCount = applications.filter(
    (application) => application.statusKey === "review",
  ).length;

  const approvedCount = applications.filter(
    (application) => application.statusKey === "approved",
  ).length;

  // Application details are read-only for guardians; opening a row loads it by reference.
  const handleViewApplication = (application) => {
    navigate(`${GUARDIAN_PATHS.myApplications}/${application.reference}`);
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <GuardianHeader navItems={NAV_ITEMS} guardianName={guardianName} initials={initials || "GW"} />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:p-10">
        <section
          aria-label="My Applications heading"
          className="flex flex-col justify-between gap-6 md:flex-row md:items-end"
        >
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Guardian portal</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              My Applications
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              View your bursary applications and track their progress.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate(GUARDIAN_PATHS.newApplication)}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 md:w-auto"
          >
            <Plus className="size-4" aria-hidden="true" />
            New Application
          </button>
        </section>

        {error && (
          <p role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            {error}
          </p>
        )}

        <section
          aria-label="Application summary"
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <SummaryCard
            label="Total Applications"
            count={APPLICATIONS.length}
            description="For students you support"
            icon={Files}
          />
          <SummaryCard
            label="Submitted"
            count={submittedCount}
            description="Awaiting assessment"
            icon={Send}
          />
          <SummaryCard
            label="Under Review"
            count={reviewCount}
            description="Being assessed"
            icon={Clock3}
          />
          <SummaryCard
            label="Approved"
            count={approvedCount}
            description="Successfully approved"
            icon={CircleCheck}
          />
        </section>

        <section aria-label="Applications list" className={`${CARD_CLASS} mt-8 overflow-hidden`}>
          <div className="flex flex-col justify-between gap-4 border-b border-border px-6 py-5 lg:flex-row lg:items-center">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Applications</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Submitted applications are read-only. Select an application to view its details.
              </p>
            </div>

            <span className="w-fit rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
              {APPLICATIONS.length} applications
            </span>
          </div>

          <div className="p-4 sm:p-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-md">
                <Search
                  className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by student name or reference number"
                  aria-label="Search applications"
                  className={`${CONTROL_CLASS} w-full pl-10 pr-4`}
                />
              </div>

              <div className="flex items-center gap-3">
                <label
                  htmlFor="status-filter"
                  className="whitespace-nowrap text-sm font-medium text-muted-foreground"
                >
                  Status
                </label>
                <select
                  id="status-filter"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  className={`${CONTROL_CLASS} min-w-48 flex-1 px-3 lg:flex-none`}
                >
                  <option value="all">All Applications</option>
                  <option value="submitted">Submitted</option>
                  <option value="review">Under Review</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                </select>
              </div>
            </div>

            {filteredApplications.length > 0 ? (
              <>
                {/* Desktop table; the card list below carries the same rows on small screens. */}
                <div className="mt-6 hidden overflow-x-auto rounded-lg border border-border md:block">
                  <table className="w-full min-w-[850px] border-collapse text-left">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        {["Reference Number", "Student Name", "School", "Submission Date", "Status", "Action"].map(
                          (column) => (
                            <th
                              key={column}
                              scope="col"
                              className={`text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                                column === "Reference Number" ? "px-5 py-4" : "p-4"
                              } ${column === "Action" ? "px-5 py-4 text-right" : ""}`}
                            >
                              {column}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>

                    <tbody>
                      {filteredApplications.map((application) => (
                        <tr
                          key={application.reference}
                          className="border-b border-border last:border-b-0"
                        >
                          <td className="p-5 font-mono text-sm font-medium text-foreground">
                            {application.reference}
                          </td>
                          <td className="px-4 py-5 text-sm font-medium text-foreground">
                            {application.student}
                          </td>
                          <td className="px-4 py-5 text-sm text-muted-foreground">
                            {application.school}
                          </td>
                          <td className="px-4 py-5 text-sm text-muted-foreground">
                            {application.date}
                          </td>
                          <td className="px-4 py-5">
                            <StatusBadge
                              status={application.status}
                              statusKey={application.statusKey}
                            />
                          </td>
                          <td className="p-5 text-right">
                            <button
                              type="button"
                              onClick={() => handleViewApplication(application)}
                              className="text-sm font-medium text-primary hover:underline"
                            >
                              View Application
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-6 flex flex-col gap-3 md:hidden">
                  {filteredApplications.map((application) => (
                    <ApplicationCard
                      key={application.reference}
                      application={application}
                      onView={handleViewApplication}
                    />
                  ))}
                </div>
              </>
            ) : (
              <div className="mx-auto mt-8 flex max-w-md flex-col items-center rounded-lg border border-dashed border-border bg-muted/40 px-6 py-12 text-center">
                <div className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
                  <FileSearch className="size-5" aria-hidden="true" />
                </div>
                <h3 className="mt-4 text-base font-semibold text-foreground">
                  No matching applications
                </h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Try changing your search or status filter to find an application.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm("");
                    setStatusFilter("all");
                  }}
                  className="mt-4 text-sm font-semibold text-primary hover:underline"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </section>

        <section
          aria-label="Read-only notice"
          className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-card px-5 py-4"
        >
          <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">
              Submitted applications are read-only
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              You can view application details and status updates, but submitted information cannot
              be changed here.
            </p>
          </div>
        </section>
      </main>

      <GuardianFooter />
    </div>
  );
}
