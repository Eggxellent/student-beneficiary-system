import { useEffect, useState } from "react";
import { LockKeyhole, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import {
  GUARDIAN_PATHS,
  GuardianFooter,
  GuardianHeader,
  guardianSectionNav,
} from "../components/GuardianChrome";
import { useAuth } from "../context/AuthContext";
import { fetchGuardianProfile, apiErrorMessage } from "../services/guardian";

// Guardian account page. Details are read from GET /api/guardian/me, which returns the signed-in
// guardian's users row; Sign Out clears the stored token and returns to the shared sign-in form.

const NAV_ITEMS = guardianSectionNav("account");

const RELATIONSHIP_LABELS = {
  parent: "Parent",
  legal_guardian: "Legal Guardian",
  adult_student: "Adult Student (18+)",
  authorised_caregiver: "Authorised Caregiver",
};

function formatDate(value, withTime = false) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function initialsOf(name) {
  return (name || "Guardian")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

function maskNationalId(value) {
  if (!value) return "Not provided";
  return value.length <= 4 ? value : `********${value.slice(-4)}`;
}


function DetailItem({ label, value, mono = false }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-1 break-words text-sm font-medium text-foreground ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function SectionCard({ title, description, icon: Icon, children }) {
  return (
    <section className={`overflow-hidden ${CARD_CLASS}`}>
      <div className="flex items-start gap-3 border-b border-border px-6 py-5">
        {Icon && (
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
            <Icon className="size-[18px]" aria-hidden="true" />
          </div>
        )}
        <div>
          <h2 className="text-lg font-semibold text-primary">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="grid gap-6 p-6 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export default function GuardianAccount() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetchGuardianProfile()
      .then((record) => { if (active) setProfile(record); })
      .catch((err) => { if (active) setError(apiErrorMessage(err, "Could not load your account details.")); });
    return () => { active = false; };
  }, []);

  const account = {
    name: profile?.full_name || user?.full_name || "Guardian",
    email: profile?.email || user?.email || "Not available",
    phone: profile?.phone || "Not provided",
    relationship: RELATIONSHIP_LABELS[profile?.relationship_to_student] || "Not provided",
    nationalId: maskNationalId(profile?.national_id),
    created: formatDate(profile?.created_at),
    lastLogin: formatDate(profile?.last_login_at, true),
  };
  const initials = initialsOf(account.name);

  const handleSignOut = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <GuardianHeader
        navItems={NAV_ITEMS}
        guardianName={account.name}
        initials={initials}
      />

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
        <nav aria-label="Breadcrumb" className="mb-7 text-sm">
          <Link
            to={GUARDIAN_PATHS.dashboard}
            className="text-muted-foreground transition hover:text-primary"
          >
            Dashboard
          </Link>
          <span className="mx-2 text-muted-foreground" aria-hidden="true">
            /
          </span>
          <span aria-current="page" className="font-medium text-primary">
            Account
          </span>
        </nav>

        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-muted-foreground">Guardian portal</p>
          <h1 className="text-3xl font-semibold tracking-tight text-primary">My Account</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            View your personal information and account details.
          </p>
        </div>

        {error && (
          <p role="alert" className="mb-6 rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
            {error}
          </p>
        )}

        <section
          aria-label="Account summary"
          className={`flex flex-col gap-5 ${CARD_CLASS} p-6 sm:flex-row sm:items-center sm:justify-between`}
        >
          <div className="flex items-center gap-4">
            <div className="grid size-14 shrink-0 place-items-center rounded-full bg-accent text-lg font-semibold text-accent-foreground">
              {initials}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-xl font-semibold text-foreground">{account.name}</h2>
                <span className="rounded-full border border-secondary/30 bg-accent px-3 py-1 text-xs font-medium text-secondary">
                  Active
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">Guardian account</p>
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <UserRound className="size-3.5 text-primary" aria-hidden="true" />
                Account holder
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-lg bg-accent/70 px-4 py-3 sm:min-w-52">
            <ShieldCheck className="size-5 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="text-xs font-medium text-foreground">Account status</p>
              <p className="mt-0.5 text-sm font-semibold text-primary">Active and secure</p>
            </div>
          </div>
        </section>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <SectionCard
            title="Personal Information"
            description="Information associated with your guardian account."
            icon={UserRound}
          >
            <DetailItem label="Full name" value={account.name} />
            <DetailItem label="Relationship to student" value={account.relationship} />
            <div className="sm:col-span-2">
              <DetailItem label="Email address" value={account.email} />
            </div>
            <DetailItem label="Phone number" value={account.phone} />
            <DetailItem label="National ID" value={account.nationalId} mono />
          </SectionCard>

          <SectionCard
            title="Account & Security"
            description="Security details for your SBMS account."
            icon={LockKeyhole}
          >
            <div className="sm:col-span-2">
              <DetailItem label="Registered email address" value={account.email} />
            </div>
            <DetailItem label="Password" value="••••••••••" mono />
            <DetailItem label="Account created" value={account.created} />
            <div className="sm:col-span-2">
              <DetailItem label="Last login" value={account.lastLogin} />
            </div>
          </SectionCard>
        </div>

        <section
          aria-label="Sign out"
          className={`mt-6 flex flex-col justify-between gap-4 ${CARD_CLASS} px-6 py-5 sm:flex-row sm:items-center`}
        >
          <div className="flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
              <LogOut className="size-4" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Sign out of SBMS</h2>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                End your current guardian session on this device.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSignOut}
            className="h-10 shrink-0 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Sign Out
          </button>
        </section>

      </main>

      <GuardianFooter />
    </div>
  );
}
