import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, ShieldAlert, ShieldQuestion, WifiOff } from "lucide-react";
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
    // Only an explicit `verified` answer counts as success. Any unexpected shape is treated as
    // "not found" rather than being displayed as a valid certificate.
    if (answer.valid === true && answer.status === "verified") setStatus("verified");
    else if (answer.status === "revoked") setStatus("revoked");
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
        The reference is printed on the certificate below the QR code, for example {REFERENCE_EXAMPLE}.
        Letter case and spaces do not matter.
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
            Scan the QR code on an SBMS bursary award certificate, or type the certificate reference
            printed on it. Every answer is read from the SBMS database, so a code or reference copied
            onto an altered document is checked against the record that was actually issued.
          </p>
          {referenceForm}
        </div>
      )}

      {status === "verified" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="success" icon={BadgeCheck}>Current certificate</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              This certificate matches an approved bursary award
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              SBMS issued this certificate for the award recorded below, and the award is still
              approved. Compare every field with the document you were given.
            </p>
          </div>
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
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <h3 className="text-sm font-semibold text-amber-900">Compare the document before relying on it</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-amber-900">
              <li>
                The name, institution, academic year, amount and reference printed on the paper must
                match this page.
              </li>
              <li>
                A QR code or reference copied onto an altered document still returns this record, so a
                match here does not make different printed details genuine.
              </li>
              <li>
                Only the answer shown on this page, checked just now, is authoritative. A screenshot or
                a copy of this page is not.
              </li>
            </ul>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">What this result means</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              <li>SBMS approved the bursary award named above and issued this certificate for it.</li>
              <li>
                Approval is not payment: SBMS records bursary decisions and does not confirm that any
                money has been paid.
              </li>
              <li>
                If any printed detail differs from this page, treat the document as unverified and ask
                the awarding office to confirm it.
              </li>
            </ul>
          </div>
        </div>
      )}

      {status === "revoked" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="danger" icon={ShieldAlert}>Not current</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              This certificate has been revoked and is no longer valid.
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              SBMS issued this reference, but the certificate was withdrawn. A revoked certificate must
              not be accepted, even though the printed document still exists.
            </p>
          </div>
          <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Academic year" value={result?.award_period} />
            <DetailRow label="Revoked on" value={formatDate(result?.revoked_at)} />
            <DetailRow label="Certificate status" value="Revoked" />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">What to do next</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              <li>
                Ask the awarding office for the current position before releasing funds or offering a
                place.
              </li>
              <li>
                Revoking a certificate does not by itself cancel the bursary award decision; only the
                office can confirm what the award now is.
              </li>
            </ul>
          </div>
        </div>
      )}

      {status === "not-current" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="warning" icon={AlertTriangle}>No longer current</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              This certificate no longer matches the award record
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              SBMS issued this certificate, but the award it certifies has changed since then, so the
              printed document can no longer be relied on. Ask the awarding office to confirm the
              current award and to issue a replacement certificate if appropriate.
            </p>
          </div>
          <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Certificate status" value="Superseded" />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
        </div>
      )}

      {status === "not-found" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="danger" icon={ShieldQuestion}>Not found</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Certificate not found</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              This reference could not be verified in SBMS. A QR code that was generated by hand,
              copied from another document or altered after printing cannot pass verification.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">What to do next</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              <li>Check the reference against the certificate character by character, with no missing groups.</li>
              <li>Scan the QR code printed on the certificate itself, in good light.</li>
              <li>Ask the awarding office to confirm the certificate reference directly.</li>
            </ul>
          </div>
          {checked && <p className="text-xs text-slate-600">Checked at {checked} (device time).</p>}
        </div>
      )}

      {status === "rate-limited" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="warning" icon={AlertTriangle}>Please wait</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Too many checks in a short time</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              Certificate verification is rate limited to protect the records. No result was produced
              for this certificate. Wait a few minutes, then check again.
            </p>
          </div>
          <RetryButton onClick={retry}>Try again</RetryButton>
        </div>
      )}

      {status === "unavailable" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="warning" icon={WifiOff}>Connection problem</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Verification is temporarily unavailable</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              The verification service could not be reached, so this certificate was
              <strong> not</strong> checked. This is a connection problem, not a statement that the
              certificate is invalid.
            </p>
          </div>
          <RetryButton onClick={retry} />
        </div>
      )}

      {["verified", "revoked", "not-current", "not-found"].includes(status) && (
        <div className="mt-8 border-t border-slate-200 pt-6">{referenceForm}</div>
      )}
    </PublicVerificationLayout>
  );
}
