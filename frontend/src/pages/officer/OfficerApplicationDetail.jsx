import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Eye,
  FileWarning,
  Fingerprint,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
} from "lucide-react";
import api from "../../services/api";
import {
  Alert,
  Badge,
  Button,
  Card,
  DataRow,
  EmptyState,
  Field,
  Modal,
  PageHeader,
  Skeleton,
  Tabs,
} from "../../components/ui/primitives";
import {
  caseMeta,
  formatDate,
  formatDateTime,
  maskIdentifier,
  openCases,
  screeningSummary,
  statusMeta,
} from "../../lib/applicationStatus";

const EMPTY_ELIGIBILITY = {
  fee_balance: "",
  household_income: "",
  vulnerability_status: "low",
  siblings_in_school: "",
  prior_bursary_history: "none",
};

const CLOSABLE = new Set(["submitted", "screened", "needs_investigation", "investigated", "resolved"]);

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "duplicate", label: "Duplicate screening" },
  { id: "investigation", label: "Investigation" },
  { id: "eligibility", label: "Eligibility" },
  { id: "identifiers", label: "Identifiers" },
];

const FEATURE_LABELS = {
  name_similarity: "Name similarity",
  dob_match: "Date of birth match",
  school_match: "School match",
  guardian_match: "Guardian match",
  upi_match: "UPI match",
  birth_certificate_match: "Birth certificate match",
  national_id_match: "National ID match",
};

export default function OfficerApplicationDetail() {
  const { id } = useParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("overview");

  const [revealed, setRevealed] = useState(null);
  const [investigation, setInvestigation] = useState({ findings: "", recommendation: "needs_further_checks", notes: "" });
  const [eligibility, setEligibility] = useState(EMPTY_ELIGIBILITY);
  const [closureReason, setClosureReason] = useState("");
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/applications/${id}`);
      setDetail(response.data);
    } catch (err) {
      setDetail(null);
      setError(err.response?.data?.message || "Unable to load that application.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setRevealed(null);
    setTab("overview");
    setNotice("");
    loadDetail();
  }, [loadDetail]);

  async function run(action, successMessage) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(successMessage);
      await loadDetail();
      return true;
    } catch (err) {
      const body = err.response?.data;
      const flattened = body?.errors?.fieldErrors || {};
      const firstFieldError = Object.values(flattened).flat().filter(Boolean)[0];
      setError(firstFieldError || body?.message || "The action could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const application = detail?.application || null;
  const cases = detail?.duplicate_cases || [];
  const open = openCases(cases);
  const meta = application ? statusMeta(application.status) : null;
  const screening = screeningSummary(application, cases);

  const canInvestigate = application?.status === "needs_investigation";
  const canVerify =
    Boolean(application) &&
    ["screened", "resolved"].includes(application.status) &&
    !application.duplicate_of_student_id &&
    open.length === 0;
  const canWithdraw = Boolean(application) && CLOSABLE.has(application.status) && !application.duplicate_of_student_id;

  const identifierValue = useCallback(
    (field) => {
      if (revealed) return revealed[field] || "Not provided";
      return application?.[field] ? maskIdentifier(application[field]) : null;
    },
    [application, revealed]
  );

  async function revealIdentifiers() {
    setBusy(true);
    setError("");
    try {
      const response = await api.get(`/applications/${id}/identifiers`);
      setRevealed(response.data.application);
      setNotice("Identifiers revealed for this review. The reveal is recorded in the audit log.");
    } catch (err) {
      setError(err.response?.data?.message || "Identifiers could not be revealed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitInvestigation(event) {
    event.preventDefault();
    await run(
      () => api.post(`/applications/${id}/investigation`, investigation),
      "Investigation findings recorded. The administrator makes the duplicate decision."
    );
  }

  async function submitVerification(event) {
    event.preventDefault();
    await run(
      () =>
        api.post(`/applications/${id}/verify`, {
          eligibility: {
            fee_balance: Number(eligibility.fee_balance),
            household_income: Number(eligibility.household_income),
            vulnerability_status: eligibility.vulnerability_status,
            siblings_in_school: Number(eligibility.siblings_in_school),
            prior_bursary_history: eligibility.prior_bursary_history,
          },
        }),
      "Application verified and the student record created."
    );
  }

  async function withdraw() {
    const succeeded = await run(
      () => api.post(`/applications/${id}/withdraw`, { reason: closureReason.trim() }),
      "Application withdrawn. The reason is on the application and in the audit log."
    );
    if (succeeded) {
      setConfirmWithdraw(false);
      setClosureReason("");
    }
  }

  const features = useMemo(() => {
    const list = [];
    for (const entry of cases) {
      const raw = entry.comparison_features;
      if (raw && typeof raw === "object") {
        for (const [key, value] of Object.entries(raw)) {
          list.push({ caseId: entry.id, key, label: featureLabel(key), value: featureValue(value) });
        }
      }
    }
    return list;
  }, [cases]);


  if (loading) {
    return (
      <div className="sb-card sb-card--pad">
        <Skeleton lines={4} />
      </div>
    );
  }

  if (error && !application) {
    return (
      <div className="sb-stack">
        <Link to="/applications" className="sb-link">
          <ArrowLeft size={14} aria-hidden="true" />
          Back to applications
        </Link>
        <Alert tone="error" title="Application unavailable">
          {error}
        </Alert>
      </div>
    );
  }

  if (!application) return null;

  return (
    <div className="sb-stack sb-animate-rise">
      <Link to="/applications" className="sb-link">
        <ArrowLeft size={14} aria-hidden="true" />
        Back to applications
      </Link>

      <PageHeader
        eyebrow={`Application ${String(application.id).slice(0, 8).toUpperCase()}`}
        title={application.full_name}
        subtitle={`${application.school_code} · submitted ${formatDate(application.created_at)} · date of birth ${formatDate(application.date_of_birth)}`}
        actions={
          <div className="sb-row">
            <Badge tone={meta.tone}>{meta.label}</Badge>
            <Button size="sm" onClick={loadDetail} disabled={busy}>
              <RefreshCw size={14} aria-hidden="true" />
              Refresh
            </Button>
            <Button size="sm" onClick={revealIdentifiers} disabled={busy || Boolean(revealed)}>
              <Eye size={14} aria-hidden="true" />
              {revealed ? "Identifiers revealed" : "Reveal identifiers"}
            </Button>
          </div>
        }
      />

      {notice && (
        <Alert tone="success" title="Recorded">
          {notice}
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      {application.screening_failure_code && (
        <Alert tone="warning" title="Screening was not completed" icon={FileWarning}>
          Screening did not complete ({application.screening_failure_code}). This application has not been
          cleared by screening, so check the identity details manually.
        </Alert>
      )}

      {application.duplicate_of_student_id && (
        <Alert tone="error" title="Resolved as a duplicate">
          This application was resolved as a duplicate of an existing student. It cannot create a second
          student record or receive an award.
        </Alert>
      )}

      {["rejected", "withdrawn"].includes(application.status) && (
        <Alert tone="neutral" title={application.status === "rejected" ? "Rejected application" : "Withdrawn application"}>
          {application.closure_reason || "No reason recorded."} Closed {formatDateTime(application.closed_at)}.
        </Alert>
      )}

      <Card title="Application sections" bodyClassName="">
        <Tabs tabs={TABS} value={tab} onChange={setTab} label="Application sections" />
        <div style={{ padding: 20 }} role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
          {tab === "overview" && (
            <div className="sb-split">
              <div className="sb-stack">
                <div className="sb-panel">
                  <p className="sb-eyebrow">Next action</p>
                  <p style={{ marginTop: 6, fontWeight: 600, color: "var(--sb-primary-dark)" }}>{meta.description}</p>
                  <div className="sb-row" style={{ marginTop: 12 }}>
                    {canInvestigate && (
                      <Button variant="primary" size="sm" onClick={() => setTab("investigation")}>
                        Record investigation findings
                      </Button>
                    )}
                    {canVerify && (
                      <Button variant="primary" size="sm" onClick={() => setTab("eligibility")}>
                        Verify eligibility
                      </Button>
                    )}
                    {application.status === "verified" && (
                      <Link to="/awards" className="sb-btn sb-btn--primary sb-btn--sm">
                        Recommend an award
                      </Link>
                    )}
                    {!canInvestigate && !canVerify && application.status !== "verified" && (
                      <span className="sb-meta">No Field Officer action is available at this status.</span>
                    )}
                  </div>
                </div>

                <div>
                  <h3 className="sb-card__title" style={{ marginBottom: 8 }}>
                    Duplicate screening
                  </h3>
                  <Alert tone={screening.tone} title={screening.label} icon={ShieldAlert}>
                    {screening.detail}
                  </Alert>
                </div>

                <div>
                  <h3 className="sb-card__title" style={{ marginBottom: 8 }}>
                    Administrator decision context
                  </h3>
                  <div className="sb-panel">
                    <p className="sb-subtitle">
                      {["needs_investigation", "investigated"].includes(application.status)
                        ? "The duplicate case is open. Final duplicate decisions are made by the administrator."
                        : application.decision_reason || "No administrator note is recorded on this application."}
                    </p>
                  </div>
                </div>
              </div>

              <div className="sb-stack">
                <dl className="sb-dl">
                  <DataRow label="Application reference" value={application.id} mono />
                  <DataRow label="School" value={application.school_code} />
                  <DataRow label="Guardian" value={application.guardian_name} />
                  <DataRow label="Guardian phone" value={identifierValue("guardian_phone")} />
                  <DataRow label="Submitted" value={formatDateTime(application.created_at)} />
                  <DataRow label="Last updated" value={formatDateTime(application.updated_at)} />
                  <DataRow label="Verified" value={application.verified_at ? formatDateTime(application.verified_at) : null} />
                </dl>
                <Button onClick={revealIdentifiers} disabled={busy || Boolean(revealed)} block>
                  <Fingerprint size={15} aria-hidden="true" />
                  {revealed ? "Identifiers revealed for this review" : "Reveal identifiers (audited)"}
                </Button>
              </div>
            </div>
          )}
          {tab === "duplicate" && (
            <div className="sb-stack">
              <Alert tone={screening.tone} title={screening.label} icon={screening.tone === "success" ? ShieldCheck : ShieldAlert}>
                {screening.detail}
              </Alert>

              {cases.length === 0 ? (
                <EmptyState title="No potential duplicate recorded" icon={CheckCircle2}>
                  Identity screening did not open a duplicate case for this application. A missing record is
                  never treated as a match.
                </EmptyState>
              ) : (
                <div className="sb-table-wrap">
                  <table className="sb-table">
                    <thead>
                      <tr>
                        <th scope="col">Candidate student</th>
                        <th scope="col">Matched identifiers</th>
                        <th scope="col">Screening score</th>
                        <th scope="col">Case</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cases.map((entry) => {
                        const caseStatus = caseMeta(entry.status);
                        return (
                          <tr key={entry.id}>
                            <td>
                              <span className="sb-table__primary">{entry.matched_full_name}</span>
                              <span className="sb-table__sub">{entry.matched_school_code || "School not recorded"}</span>
                            </td>
                            <td>
                              <span className="sb-table__sub" style={{ marginTop: 0 }}>
                                UPI {entry.matched_upi || "not available"}
                              </span>
                              <span className="sb-table__sub">BC {entry.matched_birth_certificate_number || "not available"}</span>
                            </td>
                            <td>
                              <span className="sb-table__primary">{entry.probability ?? "—"}</span>
                              <span className="sb-table__sub">threshold {entry.review_threshold ?? "—"} · advisory</span>
                            </td>
                            <td>
                              <Badge tone={caseStatus.tone}>{caseStatus.label}</Badge>
                              <span className="sb-table__sub">{formatDate(entry.created_at)}</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="sb-panel">
                <p className="sb-label">Matching evidence recorded by screening</p>
                {features.length === 0 ? (
                  <p className="sb-hint" style={{ marginTop: 6 }}>
                    No comparison evidence was stored for this application. Missing evidence is never
                    presented as a match.
                  </p>
                ) : (
                  <dl className="sb-dl sb-dl--2" style={{ marginTop: 6 }}>
                    {features.map((feature) => (
                      <DataRow key={`${feature.caseId}-${feature.key}`} label={feature.label} value={feature.value} />
                    ))}
                  </dl>
                )}
              </div>

              <p className="sb-hint">
                A screening score is evidence for a reviewer, not a decision, and it is not a calibrated
                probability. Only exact identifier agreement or a recorded human decision makes a duplicate.
              </p>
            </div>
          )}

          {tab === "investigation" && (
            <div className="sb-stack">
              <Alert tone="info" title="Final duplicate decisions are made by the Admin">
                A Field Officer records what was checked and a recommendation. The administrator decides
                whether the application is a duplicate.
              </Alert>

              {canInvestigate ? (
                <form onSubmit={submitInvestigation} className="sb-stack">
                  <Field
                    label="Investigation findings"
                    htmlFor="findings"
                    required
                    hint="Which documents, records or visits were checked, and what they showed."
                  >
                    <textarea
                      id="findings"
                      required
                      minLength={5}
                      maxLength={2000}
                      rows={5}
                      value={investigation.findings}
                      onChange={(event) => setInvestigation((current) => ({ ...current, findings: event.target.value }))}
                      className="sb-input"
                      placeholder="e.g. Compared the birth certificate with the school register; guardian confirmed the student's identity."
                    />
                  </Field>

                  <div className="sb-grid sb-grid--2">
                    <Field label="Recommendation" htmlFor="recommendation" required>
                      <select
                        id="recommendation"
                        value={investigation.recommendation}
                        onChange={(event) => setInvestigation((current) => ({ ...current, recommendation: event.target.value }))}
                        className="sb-input"
                      >
                        <option value="likely_duplicate">Likely duplicate</option>
                        <option value="likely_not_duplicate">Likely not a duplicate</option>
                        <option value="needs_further_checks">Needs further checks</option>
                      </select>
                    </Field>
                    <Field label="Notes" htmlFor="notes" optional>
                      <input
                        id="notes"
                        maxLength={2000}
                        value={investigation.notes}
                        onChange={(event) => setInvestigation((current) => ({ ...current, notes: event.target.value }))}
                        className="sb-input"
                        placeholder="Anything the administrator should know"
                      />
                    </Field>
                  </div>

                  <div className="sb-row">
                    <Button type="submit" variant="primary" disabled={busy || investigation.findings.trim().length < 5}>
                      {busy ? "Recording…" : "Submit findings"}
                    </Button>
                    <span className="sb-meta">Findings are recorded against the application and the audit log.</span>
                  </div>
                </form>
              ) : (
                <div className="sb-panel">
                  <p className="sb-subtitle">
                    {application.status === "investigated"
                      ? "Findings have been submitted. The application is awaiting the administrator's duplicate decision."
                      : `This application is in status “${meta.label}”, so it is not awaiting investigation.`}
                  </p>
                  {open.length > 0 && (
                    <ul className="sb-dl" style={{ marginTop: 12, listStyle: "none", padding: 0 }}>
                      {open.map((entry) => (
                        <li key={entry.id} className="sb-dl__row">
                          <dt>{entry.matched_full_name}</dt>
                          <dd>
                            <Badge tone={caseMeta(entry.status).tone}>{caseMeta(entry.status).label}</Badge>
                          </dd>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "eligibility" && (
            <div className="sb-stack">
              {canVerify ? (
                <form onSubmit={submitVerification} className="sb-stack">
                  <Alert tone="info" title="Eligibility is assessed using defined rules">
                    Eligibility uses the office's eligibility rules and the information recorded below. It is
                    separate from the duplicate-screening model and is not an award approval.
                  </Alert>

                  <div className="sb-grid sb-grid--2">
                    <Field label="Fee balance (KSh)" htmlFor="fee_balance" required>
                      <input id="fee_balance" type="number" min="0" step="0.01" required value={eligibility.fee_balance}
                        onChange={(event) => setEligibility((current) => ({ ...current, fee_balance: event.target.value }))}
                        className="sb-input" />
                    </Field>
                    <Field label="Household income (KSh)" htmlFor="household_income" required>
                      <input id="household_income" type="number" min="0" step="0.01" required value={eligibility.household_income}
                        onChange={(event) => setEligibility((current) => ({ ...current, household_income: event.target.value }))}
                        className="sb-input" />
                    </Field>
                    <Field label="Vulnerability status" htmlFor="vulnerability_status" required>
                      <select id="vulnerability_status" value={eligibility.vulnerability_status}
                        onChange={(event) => setEligibility((current) => ({ ...current, vulnerability_status: event.target.value }))}
                        className="sb-input">
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </Field>
                    <Field label="Siblings in school" htmlFor="siblings_in_school" required>
                      <input id="siblings_in_school" type="number" min="0" step="1" required value={eligibility.siblings_in_school}
                        onChange={(event) => setEligibility((current) => ({ ...current, siblings_in_school: event.target.value }))}
                        className="sb-input" />
                    </Field>
                    <Field label="Prior bursary history" htmlFor="prior_bursary_history" required>
                      <select id="prior_bursary_history" value={eligibility.prior_bursary_history}
                        onChange={(event) => setEligibility((current) => ({ ...current, prior_bursary_history: event.target.value }))}
                        className="sb-input">
                        <option value="none">None</option>
                        <option value="low">Low</option>
                        <option value="high">High</option>
                      </select>
                    </Field>
                  </div>

                  <div className="sb-row">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={
                        busy ||
                        eligibility.fee_balance === "" ||
                        eligibility.household_income === "" ||
                        eligibility.siblings_in_school === ""
                      }
                    >
                      {busy ? "Verifying…" : "Verify and create student"}
                    </Button>
                    <span className="sb-meta">Verification creates the student record from this application.</span>
                  </div>
                </form>
              ) : application.eligibility_score != null ? (
                <div className="sb-stack">
                  <div className="sb-grid sb-grid--3">
                    <div className="sb-stat">
                      <span className="sb-stat__label">Eligibility score</span>
                      <span className="sb-stat__value">{application.eligibility_score} / 100</span>
                    </div>
                    <div className="sb-stat sb-stat--success">
                      <span className="sb-stat__label">Category</span>
                      <span className="sb-stat__value" style={{ fontSize: 20 }}>
                        {application.eligibility_category || "Not recorded"}
                      </span>
                    </div>
                    <div className="sb-stat">
                      <span className="sb-stat__label">Assessed</span>
                      <span className="sb-stat__value" style={{ fontSize: 18 }}>
                        {formatDate(application.eligibility_assessed_at)}
                      </span>
                    </div>
                  </div>
                  <Alert tone="info" title="Eligibility is not an approval">
                    The eligibility result records the assessment. Only an administrator decides the bursary
                    award.
                  </Alert>
                  <div className="sb-row">
                    <Link to="/awards" className="sb-btn sb-btn--primary">
                      Recommend an award
                    </Link>
                  </div>
                </div>
              ) : (
                <Alert tone="warning" title="Verification not available yet">
                  {open.length > 0
                    ? "An open duplicate case blocks verification. A Field Officer cannot override it; the administrator resolves the case first."
                    : `Verification is available once the application is cleared for eligibility. This application is in status “${meta.label}”.`}
                </Alert>
              )}
            </div>
          )}

          {tab === "identifiers" && (
            <div className="sb-stack">
              <Alert tone="info" title="Identifiers are masked by default" icon={Fingerprint}>
                Revealing full identifiers is an authorised action and is recorded in the audit trail. Reveal
                only when the review requires it.
              </Alert>

              <dl className="sb-dl sb-dl--2">
                <DataRow label="UPI" value={identifierValue("upi")} mono={Boolean(revealed)} />
                <DataRow label="Birth certificate number" value={identifierValue("birth_certificate_number")} mono={Boolean(revealed)} />
                <DataRow label="National ID" value={identifierValue("national_id_number")} mono={Boolean(revealed)} />
                <DataRow label="Guardian phone" value={identifierValue("guardian_phone")} mono={Boolean(revealed)} />
              </dl>

              <div className="sb-row">
                <Button onClick={revealIdentifiers} disabled={busy || Boolean(revealed)}>
                  <Eye size={15} aria-hidden="true" />
                  {revealed ? "Identifiers revealed" : "Reveal identifiers"}
                </Button>
                {revealed && <span className="sb-meta">The reveal has been recorded in the audit log.</span>}
              </div>
            </div>
          )}
        </div>
      </Card>

      {canWithdraw && (
        <Card title="Close this application">
          <div className="sb-stack sb-stack--tight">
            <p className="sb-subtitle">
              A Field Officer may withdraw an application when the guardian no longer wants it to continue.
              Only an administrator may reject an application. Closing requires a written reason of at least
              ten characters and is recorded in the audit log.
            </p>
            <Field label="Reason for withdrawal" htmlFor="closure_reason" required>
              <textarea
                id="closure_reason"
                rows={2}
                maxLength={2000}
                value={closureReason}
                onChange={(event) => setClosureReason(event.target.value)}
                className="sb-input"
                placeholder="Why is this application being withdrawn?"
              />
            </Field>
            <div className="sb-row">
              <Button
                variant="danger"
                onClick={() => setConfirmWithdraw(true)}
                disabled={busy || closureReason.trim().length < 10}
              >
                Withdraw application
              </Button>
              <span className="sb-meta">At least 10 characters are required.</span>
            </div>
          </div>
        </Card>
      )}

      <Modal
        open={confirmWithdraw}
        title="Withdraw this application?"
        onClose={() => setConfirmWithdraw(false)}
        actions={
          <>
            <Button onClick={() => setConfirmWithdraw(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={withdraw} disabled={busy}>
              {busy ? "Withdrawing…" : "Confirm withdrawal"}
            </Button>
          </>
        }
      >
        <p className="sb-subtitle">
          The application will be closed without creating a student record or an award. The reason is kept
          on the application and in the audit log.
        </p>
        <p className="sb-meta">{closureReason}</p>
      </Modal>
    </div>
  );
}

function featureLabel(key) {
  return FEATURE_LABELS[key] || String(key).replaceAll("_", " ");
}

function featureValue(value) {
  if (value === true) return "Match";
  if (value === false) return "No match";
  if (value === null || value === undefined || value === "") return "Not available";
  if (typeof value === "number") return value.toFixed(2);
  return String(value);
}
