import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, ShieldQuestion, WifiOff } from "lucide-react";
import api from "../services/api";
import useHashToken from "../hooks/useHashToken";
import {
  PublicVerificationLayout,
  RetryButton,
  StatusBadge,
  DetailRow,
  LoadingState,
  formatTimestamp,
} from "../components/PublicVerificationLayout";

// Public page for a bursary award certificate. It answers a different question from `/verify`: not
// "does this student record exist" but "was this certificate issued by SBMS for an approved award,
// and is it still current".
//
// Two entry points resolve to the same database row: the QR code printed on the certificate (an
// opaque token in the URL fragment) and the reference a person types off the paper. The page then
// shows exactly the facts the paper shows, so a holder, a school or an employer can compare the two.

const REFERENCE_EXAMPLE = "SBMS-2026-K8M4-X7PQ-2RZ";

function formatAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `KSh ${amount.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function ResetButton({ onClick }) {
  return (
    <button type="button" onClick={onClick} className="sb-btn">
      Check another certificate
    </button>
  );
}

export default function CertificateVerification() {
  const { token, readFailed } = useHashToken();
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("idle");
  const [checkedAt, setCheckedAt] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [referenceInput, setReferenceInput] = useState("");
  const [lastReference, setLastReference] = useState("");
  const [formError, setFormError] = useState("");

  const applyResult = useCallback((data) => {
    const answer = data || {};
    setCheckedAt(new Date());
    setResult(answer);
    // The reference is not kept in the box once it has been answered: the result below is the answer.
    setReferenceInput("");
    // Only an explicit `verified` answer counts as success. Any unexpected shape is treated as
    // "not found" rather than being displayed as a valid certificate.
    if (answer.valid === true && answer.status === "verified") setStatus("verified");
    else if (answer.status === "not_current") setStatus("not-current");
    else setStatus("not-found");
  }, []);

  const applyError = useCallback((error) => {
    setCheckedAt(new Date());
    const code = error.response?.status;
    if (code === 429) setStatus("rate-limited");
    else if (code && code < 500) setStatus("not-found");
    else setStatus("unavailable");
  }, []);

  const resetToForm = useCallback(() => {
    setStatus("idle");
    setResult(null);
    setCheckedAt(null);
    setLastReference("");
    setReferenceInput("");
    setFormError("");
  }, []);

  const lookupByReference = useCallback(
    async (reference) => {
      const trimmed = reference.trim();
      if (!trimmed) {
        setFormError("Enter the certificate reference printed on the document.");
        return;
      }
      setFormError("");
      setLastReference(trimmed);
      setStatus("loading");
      try {
        const response = await api.post("/certificates/verify", { reference: trimmed });
        applyResult(response.data);
      } catch (error) {
        applyError(error);
      }
    },
    [applyError, applyResult]
  );

  useEffect(() => {
    if (readFailed) {
      setStatus("not-found");
      return undefined;
    }
    if (!token) {
      setStatus("idle");
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");
    api
      .post("/certificates/verify", { token })
      .then((response) => {
        if (!cancelled) applyResult(response.data);
      })
      .catch((error) => {
        if (!cancelled) applyError(error);
      });

    return () => {
      cancelled = true;
    };
  }, [token, readFailed, attempt, applyResult, applyError]);

  const retry = () => {
    if (token) {
      setAttempt((value) => value + 1);
      return;
    }
    if (lastReference) lookupByReference(lastReference);
  };


  const referenceForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        lookupByReference(referenceInput);
      }}
      className="sb-stack"
    >
      <div className="sb-field">
        <label htmlFor="certificate-reference" className="sb-label">
          Certificate reference
        </label>
        <p className="sb-hint">Printed below the QR code. Letter case and spaces do not matter.</p>
        <input
          id="certificate-reference"
          name="certificate-reference"
          value={referenceInput}
          onChange={(event) => setReferenceInput(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
          placeholder={REFERENCE_EXAMPLE}
          className={`sb-input sb-code${formError ? " sb-input--error" : ""}`}
          aria-invalid={Boolean(formError)}
        />
        {formError && (
          <p className="sb-error" role="alert">
            {formError}
          </p>
        )}
      </div>
      <div className="sb-row">
        <button type="submit" disabled={status === "loading"} className="sb-btn sb-btn--primary">
          {status === "loading" ? "Checking…" : "Verify certificate"}
        </button>
      </div>
    </form>
  );

  return (
    <PublicVerificationLayout>
      <div className="sb-stack sb-stack--tight">
        <span className="sb-eyebrow">Public verification</span>
        <h1 className="sb-title">Bursary certificate verification</h1>
        <p className="sb-subtitle">
          {token ? "Scanned SBMS bursary certificate" : "Check an SBMS bursary certificate"}
        </p>
      </div>

      {status === "loading" && (
        <div style={{ marginTop: 24 }}>
          <LoadingState message="Checking this certificate…" />
          <div className="sb-skeleton sb-skeleton--line" style={{ marginTop: 16, width: "78%" }} aria-hidden="true" />
          <div className="sb-skeleton sb-skeleton--line" style={{ width: "54%" }} aria-hidden="true" />
        </div>
      )}

      {status === "idle" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <p className="sb-subtitle">
            Scan the QR code on an SBMS bursary certificate, or type the reference printed on it.
          </p>
          {referenceForm}
        </div>
      )}

      {status === "verified" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="success" icon={BadgeCheck}>
            Current certificate
          </StatusBadge>
          <p className="sb-subtitle">
            Matches an approved bursary award. Compare every field with the document in your hands.
          </p>
          <dl className="sb-dl">
            <DetailRow label="Beneficiary" value={result?.beneficiary_name} />
            <DetailRow label="Institution" value={result?.institution} />
            <DetailRow label="Bursary programme" value={programme} />
            <DetailRow label="Academic year" value={result?.award_period} />
            <DetailRow label="Approved bursary award" value={formatAmount(result?.approved_amount)} />
            <DetailRow label="Date of issue" value={formatDate(result?.issued_at)} />
            <DetailRow label="Award approved on" value={formatDate(result?.award_approved_at)} />
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Approval status" value="Current" />
            <DetailRow label="Payment tracking" value={paymentLabel} />
            <DetailRow
              label="Last payment date"
              value={payments?.last_payment_date ? formatDate(payments.last_payment_date) : "No payment recorded"}
            />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <p className="sb-hint">
            A copy of these details on altered paper is not genuine, and only this live check counts.
            Approval is not payment: the payment lines above report what SBMS has recorded, not what it has
            promised. If any printed detail differs, treat the document as unverified.
          </p>
          <ResetButton onClick={resetToForm} />
        </div>
      )}

  const checked = formatTimestamp(checkedAt);
  const reference = result?.certificate_reference;
  const programme = result?.constituency
    ? `${result.programme} · ${result.constituency} constituency`
    : result?.programme;

  const payments = result?.payments;
  const paymentLabel = !payments || payments.status === "no_payment"
    ? "No payment recorded"
    : payments.status === "pending_clearance"
      ? `Recorded, awaiting clearance — ${formatAmount(payments.total_recorded)}`
      : payments.status === "cleared"
        ? `Cleared — ${formatAmount(payments.total_cleared)}`
        : `Partly cleared — ${formatAmount(payments.total_cleared)} of ${formatAmount(result?.approved_amount)}`;

      {status === "not-current" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="warning" icon={AlertTriangle}>
            No longer current
          </StatusBadge>
          <p className="sb-subtitle">
            The award this certificate names has changed since it was issued, so the printed document can no
            longer be relied on. Ask the awarding office for a replacement.
          </p>
          <dl className="sb-dl">
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Approval status" value="Superseded" />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <ResetButton onClick={resetToForm} />
        </div>
      )}

      {status === "not-found" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="danger" icon={ShieldQuestion}>
            Not found
          </StatusBadge>
          <p className="sb-subtitle">
            This reference was not issued by SBMS. A code copied, hand-made or altered after printing cannot
            pass.
          </p>
          <p className="sb-hint">
            Check the reference character by character, scan the QR code on the certificate itself, or ask the
            awarding office to confirm.
          </p>
          {checked && <p className="sb-meta">Checked at {checked} (device time).</p>}
          <ResetButton onClick={resetToForm} />
        </div>
      )}

      {status === "rate-limited" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="warning" icon={AlertTriangle}>
            Please wait
          </StatusBadge>
          <p className="sb-subtitle">
            Too many checks in a short time, so this certificate was not checked. Wait a few minutes and try
            again.
          </p>
          <RetryButton onClick={retry}>Try again</RetryButton>
        </div>
      )}

      {status === "unavailable" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="warning" icon={WifiOff}>
            Connection problem
          </StatusBadge>
          <p className="sb-subtitle">
            The verification service could not be reached, so this certificate was <strong>not</strong> checked.
          </p>
          <RetryButton onClick={retry} />
        </div>
      )}
    </PublicVerificationLayout>
  );
}

