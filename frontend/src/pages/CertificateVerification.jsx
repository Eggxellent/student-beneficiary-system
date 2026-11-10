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
// shows exactly the facts the paper shows, so a holder, a school or an employer can compare the two
// and see whether the document in their hands describes this record.

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
    <button
      type="button"
      onClick={onClick}
      className="text-sm font-semibold text-[#173D35] underline underline-offset-2 hover:text-[#245747]"
    >
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

  const checked = formatTimestamp(checkedAt);
  const reference = result?.certificate_reference;
  const programme = result?.constituency
    ? `${result.programme} Â· ${result.constituency} constituency`
    : result?.programme;

  const referenceForm = (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        lookupByReference(referenceInput);
      }}
      className="space-y-3"
    >
      <label htmlFor="certificate-reference" className="block text-sm font-semibold text-slate-900">
        Check a certificate reference
      </label>
      <p className="text-xs leading-relaxed text-slate-600">
        Printed below the QR code, e.g. {REFERENCE_EXAMPLE}. Letter case and spaces do not matter.
      </p>
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
        className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-sm uppercase tracking-wide text-slate-900 focus:border-[#173D35] focus:outline-none focus:ring-2 focus:ring-[#173D35]/20"
      />
      {formError && <p className="text-xs font-medium text-red-700">{formError}</p>}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full rounded-md border border-[#173D35] bg-[#173D35] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#245747] disabled:opacity-60 sm:w-auto"
      >
        Verify certificate
      </button>
    </form>
  );

  return (
    <PublicVerificationLayout>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#173D35]">Bursary certificate verification</h1>
        <p className="mt-1 text-sm text-slate-600">
          {token ? "Scanned SBMS bursary award certificate" : "Check an SBMS bursary award certificate"}
        </p>
      </div>

      {status === "loading" && <div className="mt-8"><LoadingState message="Checking this certificate..." /></div>}

      {status === "idle" && (
        <div className="mt-6 space-y-5">
          <p className="text-sm leading-relaxed text-slate-700">
            Scan the QR code on an SBMS bursary award certificate, or type the reference printed on it.
          </p>
          {referenceForm}
        </div>
      )}

      {status === "verified" && (
        <div className="mt-6 space-y-4">
          <StatusBadge tone="success" icon={BadgeCheck}>Current certificate</StatusBadge>
          <p className="text-sm leading-relaxed text-slate-700">
            Matches an approved bursary award. Compare every field with the document in your hands.
          </p>
          <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <DetailRow label="Beneficiary" value={result?.beneficiary_name} />
            <DetailRow label="Institution" value={result?.institution} />
            <DetailRow label="Bursary programme" value={programme} />
            <DetailRow label="Academic year" value={result?.award_period} />
            <DetailRow label="Approved bursary award" value={formatAmount(result?.approved_amount)} />
            <DetailRow label="Date of issue" value={formatDate(result?.issued_at)} />
            <DetailRow label="Award approved on" value={formatDate(result?.award_approved_at)} />
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Certificate status" value="Current" />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <p className="text-xs leading-relaxed text-slate-600">
            A copy of these details on altered paper is not genuine, and only this live check counts. Approval is
            not payment. If any printed detail differs, treat the document as unverified.
          </p>
          <ResetButton onClick={resetToForm} />
        </div>
      )}

      {status === "not-current" && (
        <div className="mt-6 space-y-4">
          <StatusBadge tone="warning" icon={AlertTriangle}>No longer current</StatusBadge>
          <p className="text-sm leading-relaxed text-slate-700">
            The award this certificate names has changed since it was issued, so the printed document can
            no longer be relied on. Ask the awarding office for a replacement.
          </p>
          <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Certificate status" value="Superseded" />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <ResetButton onClick={resetToForm} />
        </div>
      )}

      {status === "not-found" && (
        <div className="mt-6 space-y-4">
          <StatusBadge tone="danger" icon={ShieldQuestion}>Not found</StatusBadge>
          <p className="text-sm leading-relaxed text-slate-700">
            This reference was not issued by SBMS. A code copied, hand-made or altered after printing
            cannot pass.
          </p>
          <p className="text-xs leading-relaxed text-slate-600">
            Check the reference character by character, scan the QR code on the certificate itself, or ask
            the awarding office to confirm.
          </p>
          {checked && <p className="text-xs text-slate-600">Checked at {checked} (device time).</p>}
          <ResetButton onClick={resetToForm} />
        </div>
      )}

      {status === "rate-limited" && (
        <div className="mt-6 space-y-4">
          <StatusBadge tone="warning" icon={AlertTriangle}>Please wait</StatusBadge>
          <p className="text-sm leading-relaxed text-slate-700">
            Too many checks in a short time, so this certificate was not checked. Wait a few minutes and try again.
          </p>
          <RetryButton onClick={retry}>Try again</RetryButton>
        </div>
      )}

      {status === "unavailable" && (
        <div className="mt-6 space-y-4">
          <StatusBadge tone="warning" icon={WifiOff}>Connection problem</StatusBadge>
          <p className="text-sm leading-relaxed text-slate-700">
            The verification service could not be reached, so this certificate was
            <strong> not</strong> checked.
          </p>
          <RetryButton onClick={retry} />
        </div>
      )}
    </PublicVerificationLayout>
  );
}
