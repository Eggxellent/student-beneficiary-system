import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  CircleAlert,
  CircleCheck,
  Clock3,
  FilePlusCorner,
  Files,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { GUARDIAN_PATHS, GuardianFooter, GuardianHeader } from "../components/GuardianChrome";
import { useAuth } from "../context/AuthContext";
import { fetchGuardianDashboard, apiErrorMessage } from "../services/guardian";

// Guardian dashboard (page 2 of the guardian interface). Counts and the recent-application list come
// from GET /api/guardian/dashboard, which only ever returns the signed-in guardian's own rows. The
// guardian surface has its own header (no staff sidebar), so it does not use AppLayout like the admin
// and field-officer screens — those remain untouched. The header, footer and profile menu are shared
// with the guardian application form through components/GuardianChrome.
//
// The page's call-to-actions point at the remaining guardian pages:
//   /guardian/applications/new  the new bursary application form (rendered by pages/NewApplication)
//   /guardian/profile           the guardian account page (rendered by pages/GuardianAccount)

const SUMMARY_CARDS = [
  {
    key: "total",
    label: "Total Applications",
    value: "0",
    hint: "Across all applicants",
    icon: Files,
    iconClass: "bg-secondary text-secondary-foreground",
  },
  {
    key: "review",
    label: "Under Review",
    value: "0",
    hint: "Being assessed",
    icon: Clock3,
    iconClass: "bg-accent text-accent-foreground",
  },
  {
    key: "attention",
    label: "More Information Required",
    value: "0",
    hint: "Needs your attention",
    icon: CircleAlert,
    iconClass: "bg-muted text-muted-foreground",
  },
  {
    key: "approved",
    label: "Approved",
    value: "0",
    hint: "Successfully approved",
    icon: CircleCheck,
    iconClass: "bg-primary/10 text-primary",
  },
];

const TABLE_COLUMNS = [
  "Student Name",
  "Application Reference",
  "Date Submitted",
  "Status",
  "Actions",
];

const CARD_CLASS = "rounded-xl border border-border bg-card shadow-sm";
const PRIMARY_ACTION_CLASS =
  "inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90";


function Badge({ children }) {
  return (
    <span className="w-fit rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
      {children}
    </span>
  );
}

function SummaryCard({ label, value, hint, icon: Icon, iconClass }) {
  return (
    <div className={`${CARD_CLASS} flex items-start justify-between gap-4 p-5`}>
      <div>
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <p className="mt-3 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className={`grid size-10 shrink-0 place-items-center rounded-lg ${iconClass}`}>
        <Icon className="size-5" aria-hidden="true" />
      </div>
    </div>
  );
}

function StartApplicationDialog({ open, onClose, onContinue }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("keydown", handleKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-application-title"
        aria-describedby="start-application-description"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl outline-none"
      >
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <FilePlusCorner className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id="start-application-title" className="text-lg font-semibold text-foreground">
              Start a new application
            </h2>
            <p
              id="start-application-description"
              className="mt-2 text-sm leading-6 text-muted-foreground"
            >
              The application form will ask for the student, school and household details needed for
              bursary assessment — for a child you care for, or for yourself as an adult student.
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GuardianDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchGuardianDashboard()
      .then((data) => { if (active) setDashboard(data); })
      .catch((err) => { if (active) setError(apiErrorMessage(err, "Could not load your dashboard.")); });
    return () => { active = false; };
  }, []);

  const guardianName = dashboard?.guardian?.full_name || user?.full_name || "Guardian";
  const firstName = guardianName.split(" ")[0];
  const initials = guardianName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
  const applications = dashboard?.applications || [];
  const hasApplications = applications.length > 0;
  const summaryValues = {
    total: dashboard?.summary?.total ?? 0,
    review: dashboard?.summary?.review ?? 0,
    approved: dashboard?.summary?.approved ?? 0,
    attention: 0,
  };
  const summaryCards = SUMMARY_CARDS.map((card) => ({
    ...card,
    value: String(summaryValues[card.key] ?? 0),
  }));

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <GuardianHeader guardianName={guardianName} initials={initials || "GW"} />

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:p-10">
        <section
          id="dashboard"
          aria-label="Dashboard welcome"
          className="flex flex-col justify-between gap-6 md:flex-row md:items-end"
        >
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Guardian dashboard</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Welcome back, {firstName}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Manage bursary applications for your children — or for yourself if you are an adult
              student — and track their progress from one place.
            </p>
          </div>
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={isDialogOpen}
            onClick={() => setIsDialogOpen(true)}
            className={`${PRIMARY_ACTION_CLASS} h-11 w-full md:w-auto`}
          >
            <Plus className="size-4" aria-hidden="true" />
            New Application
          </button>
        </section>

        <section
          aria-label="Application summary"
          className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {SUMMARY_CARDS.map((card) => (
            <SummaryCard
              key={card.label}
              label={card.label}
              value={summaryCards.find((entry) => entry.label === card.label)?.value ?? card.value}
              hint={card.hint}
              icon={card.icon}
              iconClass={card.iconClass}
            />
          ))}
        </section>

        <section id="applications" aria-label="My Applications table" className="mt-8">
          <div className={CARD_CLASS}>
            <div className="flex flex-col gap-3 border-b border-border px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">My Applications</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  View and track bursary applications for each child, or for yourself as an adult
                  student.
                </p>
              </div>
              <Badge>{applications.length} applications</Badge>
            </div>

            {/* The table is hidden on small screens until it has rows; the empty state below carries
                the whole message there instead of forcing a sideways scroll. */}
            <div className={`w-full overflow-x-auto ${hasApplications ? "" : "hidden md:block"}`}>
              <table className="w-full min-w-[44rem] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    {TABLE_COLUMNS.map((column) => (
                      <th
                        key={column}
                        scope="col"
                        className={`px-6 py-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${
                          column === "Actions" ? "text-right" : ""
                        }`}
                      >
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => (
                    <tr key={application.reference} className="border-b border-border last:border-b-0">
                      <td className="px-6 py-4 text-sm font-medium text-foreground">{application.student}</td>
                      <td className="px-6 py-4 font-mono text-sm text-muted-foreground">{application.reference}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{application.date}</td>
                      <td className="px-6 py-4 text-sm text-muted-foreground">{application.status}</td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          to={`${GUARDIAN_PATHS.myApplications}/${application.reference}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {!hasApplications && (
              <div className="px-4 py-16 text-center sm:px-6">
                <div className="mx-auto max-w-md">
                  <div className="mx-auto grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
                    <FilePlusCorner className="size-5" aria-hidden="true" />
                  </div>
                  <p className="mt-4 text-base font-semibold text-foreground">No applications yet</p>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                    Start a bursary application for one of your children, or for yourself as an adult
                    student, to see it listed here.
                  </p>
                  <Link
                    to={GUARDIAN_PATHS.newApplication}
                    className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-primary px-4 text-sm font-medium text-primary transition hover:bg-primary/10"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    Start an application
                  </Link>
                </div>
              </div>
            )}
          </div>
        </section>

        {error && (
          <p role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            {error}
          </p>
        )}

        <section
          id="account"
          aria-label="Account status"
          className="mt-6 flex flex-col items-start gap-3 rounded-lg border border-border bg-card px-5 py-4 sm:flex-row"
        >
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">Your account is ready</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Keep your contact details up to date so we can reach you about your applications.
            </p>
          </div>
          <Link
            to={GUARDIAN_PATHS.profile}
            className="shrink-0 text-sm font-medium text-primary hover:underline sm:ml-auto"
          >
            Manage account
          </Link>
        </section>
      </main>

      <GuardianFooter />

      <StartApplicationDialog
        open={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        onContinue={() => navigate(GUARDIAN_PATHS.newApplication)}
      />
    </div>
  );
}
