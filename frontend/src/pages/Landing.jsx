import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, FileText, Fingerprint, KeyRound, ShieldCheck, UserRound } from "lucide-react";
import PublicLayout from "../components/PublicLayout";

const STEPS = [
  {
    number: "01",
    title: "Submit student information",
    body: "A guardian enters the student's identity details and school. No account or password is needed.",
  },
  {
    number: "02",
    title: "Identity screening and review",
    body: "Details are screened for possible existing records. A possible match is reviewed by a person, never rejected automatically.",
  },
  {
    number: "03",
    title: "Eligibility verification",
    body: "A Field Officer checks eligibility information against the defined eligibility rules.",
  },
  {
    number: "04",
    title: "Award decision",
    body: "A Field Officer recommends; an administrator decides. An approved award is not a payment.",
  },
];

const FACTS = [
  {
    icon: UserRound,
    title: "Who uses this portal",
    body: "Parents and guardians applying on behalf of a student. Staff sign in separately to review applications.",
  },
  {
    icon: FileText,
    title: "Why accurate details matter",
    body: "Details are compared with existing beneficiary records, so identifiers printed on documents should be copied exactly.",
  },
  {
    icon: Fingerprint,
    title: "Why duplicate screening happens",
    body: "One student should hold one bursary record. Screening finds possible overlaps so a person can check them.",
  },
  {
    icon: KeyRound,
    title: "Keeping the tracking code safe",
    body: "The tracking code is shown once, at submission. It is the only way to follow the application, so write it down.",
  },
];

export default function Landing() {
  return (
    <PublicLayout>
      <section className="sb-hero">
        <div className="sb-container sb-hero__inner">
          <div className="sb-hero__copy">
            <span className="sb-eyebrow">NG-CDF bursary programme</span>
            <h1 className="sb-title sb-title--xl">Apply for NG-CDF student bursary support</h1>
            <p className="sb-lede">
              Submit a student application and track its progress securely using your application
              tracking code.
            </p>
            <div className="sb-hero__actions">
              <Link to="/apply" className="sb-btn sb-btn--primary sb-btn--lg">
                Start application
                <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link to="/apply/track" className="sb-btn sb-btn--lg">
                Track application
              </Link>
            </div>
            <p className="sb-meta">
              No guardian account is created. A submitted application is not an approval.
            </p>
          </div>

          <div className="sb-artifact" aria-label="Example bursary application summary">
            <div className="sb-row sb-row--between">
              <span className="sb-eyebrow">Application summary</span>
              <span className="sb-badge sb-badge--primary">Example</span>
            </div>
            <div>
              <p className="sb-meta">Student</p>
              <p style={{ fontSize: 17, fontWeight: 650, color: "var(--sb-primary-dark)" }}>
                Secondary school applicant
              </p>
              <p className="sb-meta" style={{ marginTop: 4 }}>
                Guardian-submitted · identity screening recorded
              </p>
            </div>
            <div className="sb-progress" role="presentation">
              <div className="sb-progress__bar" style={{ width: "46%" }} />
            </div>
            <dl className="sb-dl">
              <div className="sb-dl__row">
                <dt>Status</dt>
                <dd>Identity screening</dd>
              </div>
              <div className="sb-dl__row">
                <dt>Next step</dt>
                <dd>Duplicate review, if required</dd>
              </div>
            </dl>
            <div className="sb-row sb-row--between" style={{ alignItems: "flex-end" }}>
              <div>
                <p className="sb-meta">Tracking code</p>
                <p className="sb-code" style={{ fontWeight: 700, color: "var(--sb-primary-dark)" }}>
                  ••••-••••-2RZ
                </p>
              </div>
              <span className="sb-artifact__qr" aria-hidden="true">
                <BadgeCheck size={30} />
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="sb-container sb-section">
        <div className="sb-stack sb-stack--loose">
          <div className="sb-stack sb-stack--tight" style={{ maxWidth: 620 }}>
            <span className="sb-eyebrow">How it works</span>
            <h2 className="sb-title">Four steps, clearly recorded</h2>
            <p className="sb-subtitle">
              Every stage is recorded against the application. Some applications need an extra identity
              review, and that review is a check — not a rejection.
            </p>
          </div>

          <div className="sb-step-grid">
            {STEPS.map((step) => (
              <div key={step.number} className="sb-step">
                <span className="sb-step__number">{step.number}</span>
                <span className="sb-step__title">{step.title}</span>
                <span className="sb-step__body">{step.body}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sb-container sb-section" style={{ paddingTop: 0 }}>
        <div className="sb-card sb-card--pad">
          <div className="sb-row sb-row--between" style={{ marginBottom: 22, alignItems: "flex-start" }}>
            <div className="sb-stack sb-stack--tight" style={{ maxWidth: 520 }}>
              <span className="sb-eyebrow">Before you apply</span>
              <h2 className="sb-title sb-title--sm">What to have ready</h2>
            </div>
            <ShieldCheck size={22} style={{ color: "var(--sb-primary)" }} aria-hidden="true" />
          </div>
          <div className="sb-info-grid">
            {FACTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="sb-info">
                <span className="sb-info__icon">
                  <Icon size={16} aria-hidden="true" />
                </span>
                <div>
                  <p className="sb-info__title">{title}</p>
                  <p className="sb-info__body">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="sb-container" style={{ paddingBottom: 56 }}>
        <div className="sb-card sb-card--pad" style={{ background: "var(--sb-accent-soft)", borderColor: "#cfe6de" }}>
          <div className="sb-row sb-row--between" style={{ gap: 20 }}>
            <div className="sb-stack sb-stack--tight" style={{ maxWidth: 560 }}>
              <h2 className="sb-title sb-title--sm">Holding a bursary certificate?</h2>
              <p className="sb-subtitle">
                Scan the QR code on the certificate or enter its reference to confirm that the record
                exists and is still current. Verification never confirms that money was paid.
              </p>
            </div>
            <Link to="/verify-certificate" className="sb-btn sb-btn--dark">
              <BadgeCheck size={16} aria-hidden="true" />
              Open verification
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}
