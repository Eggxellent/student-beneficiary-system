import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Clock3,
  Eye,
  FileText,
  Flag,
  LockKeyhole,
} from "lucide-react";

import { GUARDIAN_PATHS, GuardianLayout } from "../components/GuardianChrome";
import { useAuth } from "../context/AuthContext";
import { fetchGuardianApplication, apiErrorMessage } from "../services/guardian";

// Guardian application details (read-only). The record is fetched from
// GET /api/guardian/applications/:reference, which only returns applications owned by the
// signed-in guardian; a reference belonging to another guardian resolves to 404.

// Rows are loaded from the API in the component below.

const CARD_CLASS = "overflow-hidden rounded-xl border border-border bg-card shadow-sm";
const CARD_HEADER_CLASS = "border-b border-border px-6 py-5";

function DetailItem({ label, value, fullWidth = false }) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-foreground">
        {value || "Not provided"}
      </p>
    </div>
  );
}

function DetailCard({ title, children }) {
  return (
    <section className={CARD_CLASS}>
      <div className={CARD_HEADER_CLASS}>
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
      </div>
      <div className="grid gap-x-6 gap-y-5 p-6 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function ProgressStep({ title, description, icon: Icon, state }) {
  const completed = state === "completed";
  const current = state === "current";

  return (
    <div className="relative flex gap-3 md:flex-col md:items-center md:text-center">
      <div
        className={`relative z-10 grid size-9 shrink-0 place-items-center rounded-full ${
          completed
            ? "bg-primary text-primary-foreground"
            : current
              ? "bg-accent text-accent-foreground ring-4 ring-accent/70"
              : "border border-border bg-background text-muted-foreground"
        }`}
      >
        <Icon className="size-4" aria-hidden="true" />
      </div>

      <div className="md:mt-3">
        <p
          className={`text-sm font-semibold ${
            current || completed ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

export default function ApplicationDetails() {
  const { reference } = useParams();
  const { user } = useAuth();
  const [application, setApplication] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setApplication(null);
    setError("");
    fetchGuardianApplication(reference)
      .then((record) => { if (active) setApplication(record); })
      .catch((err) => { if (active) setError(apiErrorMessage(err, "Could not load this application.")); });
    return () => { active = false; };
  }, [reference]);

  const guardianName = user?.full_name || "Guardian";
  const initials = guardianName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  if (!application) {
    return (
      <GuardianLayout activeItem="applications" guardianName={guardianName} initials={initials || "GW"}>
        <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:p-10">
          <Link to={GUARDIAN_PATHS.myApplications} className="text-sm font-medium text-primary hover:underline">
            Back to My Applications
          </Link>
          {error ? (
            <p role="alert" className="mt-6 rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {error}
            </p>
          ) : (
            <p className="mt-6 text-sm text-muted-foreground">Loading application...</p>
          )}
        </main>
      </GuardianLayout>
    );
  }

  const reviewState = application.statusKey === "submitted" ? "pending" : "current";
  const decisionState =
    application.statusKey === "approved" || application.statusKey === "rejected"
      ? "completed"
      : "pending";

  return (
    <GuardianLayout activeItem="applications" guardianName={guardianName} initials={initials || "GW"}>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:p-10">
        <nav aria-label="Breadcrumb" className="mb-7">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            <li>
              <Link
                to={GUARDIAN_PATHS.dashboard}
                className="text-muted-foreground transition hover:text-primary"
              >
                Dashboard
              </Link>
            </li>
            <li className="text-muted-foreground" aria-hidden="true">
              /
            </li>
            <li>
              <Link
                to={GUARDIAN_PATHS.myApplications}
                className="text-muted-foreground transition hover:text-primary"
              >
                My Applications
              </Link>
            </li>
            <li className="text-muted-foreground" aria-hidden="true">
              /
            </li>
            <li aria-current="page" className="font-medium text-primary">
              Application Details
            </li>
          </ol>
        </nav>

        <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              Submitted bursary application
            </p>

            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Application Details
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="font-mono text-sm font-medium text-primary">
                {application.reference}
              </span>
              <span className="h-4 w-px bg-border" />
              <span className="text-sm text-muted-foreground">
                Submitted {application.submittedDate}
              </span>
            </div>

            {application.decisionNote && (
              <p className="mt-4 max-w-xl rounded-md border border-border bg-accent/60 px-4 py-3 text-xs leading-5 text-foreground">
                Review note: {application.decisionNote}
              </p>
            )}
          </div>

          <span className="w-fit rounded-full border border-secondary/30 bg-accent px-3 py-1.5 text-sm font-medium text-secondary">
            {application.status}
          </span>
        </div>

        <section
          aria-label="Read-only notice"
          className="mt-7 flex items-start gap-3 rounded-lg border border-border bg-accent/70 px-5 py-4"
        >
          <LockKeyhole className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              This application is read-only
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Your application has been submitted successfully. You can view the information below,
              but submitted applications cannot be edited.
            </p>
          </div>
        </section>

        <section aria-label="Application progress" className={`${CARD_CLASS} mt-6`}>
          <div className={CARD_HEADER_CLASS}>
            <h2 className="text-lg font-semibold text-primary">Application Progress</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Track the current stage of your bursary application.
            </p>
          </div>

          <div className="p-6 py-7">
            <div className="grid gap-6 md:grid-cols-3">
              <ProgressStep
                title="Application Submitted"
                description={application.submittedDate}
                icon={Check}
                state="completed"
              />

              <ProgressStep
                title="Under Review"
                description={application.statusKey === "submitted" ? "Pending review" : "Current stage"}
                icon={Clock3}
                state={reviewState}
              />

              <ProgressStep
                title="Decision Made"
                description={
                  decisionState === "completed"
                    ? application.status
                    : "Pending review"
                }
                icon={Flag}
                state={decisionState}
              />
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <DetailCard title="Student Information">
            <DetailItem label="Student full name" value={application.student.name} />
            <DetailItem label="Date of birth" value={application.student.dateOfBirth} />
            <DetailItem label="Gender" value={application.student.gender} />
            <DetailItem
              label="Birth certificate number"
              value={application.student.identification}
              fullWidth
            />
            <DetailItem
              label="Relationship to student"
              value={application.student.relationship}
            />
          </DetailCard>

          <DetailCard title="School Information">
            <DetailItem label="School name" value={application.school.name} fullWidth />
            <DetailItem label="School level" value={application.school.level} />
            <DetailItem
              label="Admission / registration number"
              value={application.school.admissionNumber}
            />
            <DetailItem
              label="Current class / year of study"
              value={application.school.currentClass}
            />
            <DetailItem
              label="School county / sub-county"
              value={application.school.location}
            />
          </DetailCard>

          <DetailCard title="Parent and Household Information">
            <DetailItem
              label="Parent / guardian full name"
              value={application.household.guardianName}
            />
            <DetailItem
              label="Parent / guardian phone number"
              value={application.household.phone}
            />
            <DetailItem label="Household size" value={application.household.size} />
            <DetailItem
              label="Main household income source"
              value={application.household.incomeSource}
            />
            <DetailItem
              label="Approximate monthly household income"
              value={application.household.monthlyIncome}
            />
            <DetailItem
              label="Outstanding school fee balance"
              value={application.household.feeBalance}
            />
            <DetailItem
              label="Siblings currently in school"
              value={application.household.siblingsInSchool}
            />
            <DetailItem
              label="Vulnerability status"
              value={application.household.vulnerabilityStatus}
            />
            <DetailItem
              label="Prior bursary history"
              value={application.household.priorBursaryHistory}
              fullWidth
            />
          </DetailCard>

          <section className={CARD_CLASS}>
            <div className={CARD_HEADER_CLASS}>
              <h2 className="text-lg font-semibold text-primary">Supporting Documents</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Documents submitted with this application.
              </p>
            </div>

            <div className="divide-y divide-border px-6">
              {application.documents.length === 0 && (
                <p className="py-6 text-sm text-muted-foreground">
                  No documents were uploaded with this application. An authorised officer may
                  request supporting documents during assessment.
                </p>
              )}
              {application.documents.map((document, index) => {
                const Icon = document.icon || FileText;

                return (
                  <div
                    key={`${document.name}-${index}`}
                    className="flex items-center justify-between gap-3 py-4"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-9 shrink-0 place-items-center rounded-md bg-accent text-accent-foreground">
                        <Icon className="size-4" aria-hidden="true" />
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {document.name}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {document.description}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled
                      title="Document preview will be available when document storage is implemented"
                      className="inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-2 rounded-md border border-border px-3 text-xs font-medium text-muted-foreground opacity-70"
                    >
                      <Eye className="size-4" aria-hidden="true" />
                      View
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <Link
            to={GUARDIAN_PATHS.myApplications}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md border border-primary bg-card px-5 text-sm font-semibold text-primary transition hover:bg-accent"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to My Applications
          </Link>
        </div>
      </main>
    </GuardianLayout>
  );
}
