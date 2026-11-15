import { Link } from "react-router-dom";
import {
  ArrowRight, BadgeCheck, ClipboardCheck, GraduationCap, LayoutDashboard, ShieldCheck, Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Public landing page. It is the only unauthenticated screen that describes the system, so it never
// offers student registration or a bursary application: SBMS is operated by NG-CDF staff, and every
// action on this page either explains that or leads to the existing staff sign-in.
const CAPABILITIES = [
  {
    icon: Users,
    title: "Beneficiary management",
    body: "Field officers register students once, with UPI, institution and household details held in a single auditable record.",
  },
  {
    icon: ShieldCheck,
    title: "Duplicate detection",
    body: "A machine-learning review flags likely duplicate registrations so an officer can confirm or dismiss each case before an award is proposed.",
  },
  {
    icon: ClipboardCheck,
    title: "Proposal review and approval",
    body: "Bursary proposals are submitted by field officers and decided by administrators, with the reason and the actor recorded on every decision.",
  },
  {
    icon: BadgeCheck,
    title: "Document verification",
    body: "Each approved award produces a numbered bursary approval invoice that a school can verify by scanning its QR code.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Register",
    body: "A field officer captures the student's record and the system checks it against existing beneficiaries.",
  },
  {
    number: "02",
    title: "Review",
    body: "An administrator reviews the proposed bursary award, any duplicate case, and records a decision.",
  },
  {
    number: "03",
    title: "Issue",
    body: "Approval generates a bursary approval invoice with a unique number and a verification QR code.",
  },
];

function BrandMark() {
  return (
    <span className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#0B2239] ring-1 ring-[#C8A45D]/60">
        <GraduationCap size={20} className="text-[#C8A45D]" aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-[0.18em] text-[#0B2239]">SBMS</span>
        <span className="hidden text-[11px] text-[#5C6B78] sm:block">Student Beneficiary Management System</span>
      </span>
    </span>
  );
}

function InvoicePreview() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div className="absolute inset-x-4 -bottom-4 h-full rounded-xl bg-[#0B2239]/10" aria-hidden="true" />
      <div className="relative rounded-xl border border-[#DCE6EA] bg-white p-5 shadow-[0_30px_60px_-40px_rgba(11,34,57,0.55)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.16em] text-[#0B2239]">SBMS</p>
            <p className="mt-1 text-[9px] leading-relaxed text-[#5C6B78]">
              NG-CDF bursary programme
              <br />
              Approval record
            </p>
          </div>
          <span className="rounded-sm border border-[#0E6E6B]/30 bg-[#0E6E6B]/10 px-2 py-1 text-[9px] font-semibold tracking-[0.1em] text-[#0E6E6B]">
            APPROVED
          </span>
        </div>

        <div className="mt-4 border-t border-[#0B2239] pt-3">
          <p className="text-[13px] font-bold tracking-[0.06em] text-[#0B2239]">BURSARY APPROVAL INVOICE</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-[#5C6B78]">
            <span>Invoice no.</span>
            <span className="font-mono text-[9px] font-semibold text-[#12293F]">SBMS-2026-K8M4-X7PQ-2RZ</span>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-[1.3fr_1fr] gap-3">
          <div className="space-y-1.5">
            {[["Beneficiary", "Record on file"], ["UPI", "Student number"], ["Institution", "Secondary school"]].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-2 text-[9px]">
                <span className="text-[#8A97A1]">{label}</span>
                <span className="font-medium text-[#12293F]">{value}</span>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-[#E4D8B8] bg-[#FBF9F4] p-2.5">
            <p className="text-[8px] font-semibold tracking-[0.1em] text-[#8A6C2C]">APPROVED AMOUNT</p>
            <p className="mt-1 text-[15px] font-bold leading-none text-[#0B2239]">KSh 00,000</p>
            <p className="mt-1.5 text-[8px] text-[#5C6B78]">Not a payment</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-[#E4EAEE] pt-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-sm border border-[#0B2239]/20 bg-white" aria-hidden="true">
            <svg viewBox="0 0 33 33" className="h-9 w-9" role="presentation">
              <rect x="1" y="1" width="9" height="9" fill="none" stroke="#0B2239" strokeWidth="2" />
              <rect x="23" y="1" width="9" height="9" fill="none" stroke="#0B2239" strokeWidth="2" />
              <rect x="1" y="23" width="9" height="9" fill="none" stroke="#0B2239" strokeWidth="2" />
              <rect x="4" y="4" width="3" height="3" fill="#0E6E6B" />
              <rect x="26" y="4" width="3" height="3" fill="#0E6E6B" />
              <rect x="4" y="26" width="3" height="3" fill="#0E6E6B" />
              <rect x="13" y="2" width="2" height="2" fill="#0B2239" />
              <rect x="16" y="5" width="2" height="2" fill="#0B2239" />
              <rect x="13" y="8" width="2" height="2" fill="#0B2239" />
              <rect x="19" y="10" width="2" height="2" fill="#0B2239" />
              <rect x="2" y="13" width="2" height="2" fill="#0B2239" />
              <rect x="6" y="16" width="2" height="2" fill="#0B2239" />
              <rect x="10" y="13" width="2" height="2" fill="#0B2239" />
              <rect x="13" y="20" width="2" height="2" fill="#0B2239" />
              <rect x="17" y="16" width="2" height="2" fill="#0B2239" />
              <rect x="21" y="13" width="2" height="2" fill="#0B2239" />
              <rect x="25" y="17" width="2" height="2" fill="#0B2239" />
              <rect x="29" y="14" width="2" height="2" fill="#0B2239" />
              <rect x="14" y="26" width="2" height="2" fill="#0B2239" />
              <rect x="18" y="24" width="2" height="2" fill="#0B2239" />
              <rect x="22" y="27" width="2" height="2" fill="#0B2239" />
              <rect x="27" y="24" width="2" height="2" fill="#0B2239" />
            </svg>
          </div>
          <p className="text-right text-[8.5px] leading-relaxed text-[#5C6B78]">
            Scan to verify the approval
            <br />
            record on SBMS
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const { isAuthenticated, user } = useAuth();
  const dashboardPath = user?.role === "field_officer" ? "/field-officer" : "/dashboard";

  return (
    <div className="min-h-screen bg-white text-[#12293F]">
      <header className="sticky top-0 z-20 border-b border-[#E4EAEE] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <Link to="/" className="shrink-0" aria-label="SBMS home">
            <BrandMark />
          </Link>
          <nav className="hidden items-center gap-8 text-sm text-[#46545F] lg:flex" aria-label="Sections">
            <a href="#capabilities" className="hover:text-[#0B2239]">Capabilities</a>
            <a href="#process" className="hover:text-[#0B2239]">How it works</a>
            <Link to="/verify-certificate" className="hover:text-[#0B2239]">Verify a document</Link>
          </nav>
          <Link
            to={isAuthenticated ? dashboardPath : "/login"}
            className="inline-flex items-center gap-2 rounded-md bg-[#0B2239] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#12293F]"
          >
            {isAuthenticated ? <LayoutDashboard size={15} aria-hidden="true" /> : <ShieldCheck size={15} aria-hidden="true" />}
            {isAuthenticated ? "Open dashboard" : "Staff Login"}
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b border-[#E4EAEE] bg-[#F7F9FA]">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-14 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:py-20">
            <div>
              <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#0E6E6B]">
                <span className="h-px w-8 bg-[#C8A45D]" aria-hidden="true" />
                NG-CDF bursary programme
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-[-0.02em] text-[#0B2239] sm:text-5xl">
                Supporting Students.
                <span className="mt-1 block text-[#0E6E6B]">Strengthening Futures.</span>
              </h1>
              <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-[#4E5C66]">
                SBMS is the bursary office&apos;s record of who was registered, what was proposed and what was
                approved. Field officers and administrators work in one accountable process, from a student&apos;s
                first registration to a verifiable approval document.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link
                  to="/login"
                  className="inline-flex items-center gap-2 rounded-md bg-[#0B2239] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#12293F]"
                >
                  Staff Login
                  <ArrowRight size={16} aria-hidden="true" />
                </Link>
                <Link
                  to="/verify-certificate"
                  className="inline-flex items-center gap-2 rounded-md border border-[#C8D4DA] bg-white px-5 py-3 text-sm font-semibold text-[#0B2239] hover:border-[#0B2239]/40"
                >
                  Verify an approval invoice
                </Link>
              </div>
              <p className="mt-4 text-xs text-[#6B7A85]">
                Staff access only. Student registration is carried out by an authorised field officer.
              </p>
            </div>
            <InvoicePreview />
          </div>
        </section>

        <section id="capabilities" className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8A6C2C]">What SBMS does</p>
            <h2 className="mt-3 text-2xl font-bold tracking-[-0.01em] text-[#0B2239] sm:text-3xl">
              One record from registration to approval
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-[#4E5C66]">
              Every step is tied to a named officer, a stored record and an auditable decision, so a bursary award
              can always be traced back to the evidence behind it.
            </p>
          </div>

          <ul className="mt-10 grid gap-px overflow-hidden rounded-lg border border-[#E4EAEE] bg-[#E4EAEE] sm:grid-cols-2">
            {CAPABILITIES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="bg-white p-6 sm:p-7">
                <span className="flex h-9 w-9 items-center justify-center rounded-md bg-[#F1F5F3] text-[#0E6E6B]">
                  <Icon size={18} aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-[#0B2239]">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5C6B78]">{body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="process" className="bg-[#0B2239] text-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-20">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="max-w-xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#C8A45D]">How it works</p>
                <h2 className="mt-3 text-2xl font-bold sm:text-3xl">A decision that can be checked</h2>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-white/70">
                Approval is a decision, not a payment. The invoice records the approved amount, the academic year and
                the officer responsible.
              </p>
            </div>
            <ol className="mt-10 grid gap-8 sm:grid-cols-3">
              {STEPS.map((step) => (
                <li key={step.number} className="border-t border-white/15 pt-5">
                  <span className="font-mono text-xs tracking-[0.2em] text-[#C8A45D]">{step.number}</span>
                  <h3 className="mt-3 text-base font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-white/70">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
          <div className="flex flex-col gap-6 rounded-lg border border-[#E4EAEE] bg-[#FBF9F4] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
            <div className="max-w-xl">
              <h2 className="text-lg font-semibold text-[#0B2239]">Holding an approval invoice?</h2>
              <p className="mt-2 text-sm leading-relaxed text-[#4E5C66]">
                Scan the QR code on the document, or enter the invoice number, to confirm that the award is approved
                and that no later change has superseded it. Verification never confirms that funds were transferred.
              </p>
            </div>
            <Link
              to="/verify-certificate"
              className="inline-flex shrink-0 items-center gap-2 rounded-md border border-[#0B2239]/20 bg-white px-5 py-3 text-sm font-semibold text-[#0B2239] hover:border-[#0B2239]/40"
            >
              <BadgeCheck size={16} aria-hidden="true" />
              Open verification
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E4EAEE] bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 text-xs text-[#5C6B78] sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div>
            <p className="font-semibold tracking-[0.14em] text-[#0B2239]">SBMS</p>
            <p className="mt-1">Student Beneficiary Management System · NG-CDF bursary programme</p>
          </div>
          <nav className="flex flex-wrap items-center gap-5" aria-label="Footer">
            <Link to="/login" className="hover:text-[#0B2239]">Staff Login</Link>
            <Link to="/verify-certificate" className="hover:text-[#0B2239]">Verify an approval invoice</Link>
            <a href="#capabilities" className="hover:text-[#0B2239]">Capabilities</a>
          </nav>
        </div>
        <p className="mx-auto max-w-6xl px-5 pb-8 text-[11px] leading-relaxed text-[#7A8891] sm:px-8">
          Records are held for authorised bursary administration. Approval does not itself confirm that funds have
          been transferred.
        </p>
      </footer>
    </div>
  );
}
