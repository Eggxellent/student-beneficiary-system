import { useEffect, useState } from "react";
import { AlertTriangle, BadgeCheck, ShieldQuestion, ShieldX, WifiOff } from "lucide-react";
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

// Public page opened by scanning the QR code printed on a bursary award certificate. It answers a
// different question from `/verify`: not "does this student record exist" but "was this specific
// certificate issued by SBMS for an approved award, and is it still valid".

export default function CertificateVerification() {
  const { token, readFailed } = useHashToken();
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState("loading");
  const [checkedAt, setCheckedAt] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (readFailed || !token) {
      setStatus("not-recognised");
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");

    api
      .post("/certificates/verify", { token })
      .then((response) => {
        if (cancelled) return;
        const data = response.data || {};
        setCheckedAt(new Date());
        setResult(data);
        // Only an explicit `verified` answer counts as success. An unknown shape falls through to
        // "not recognised" rather than being displayed as a valid certificate.
        if (data.valid === true && data.status === "verified") setStatus("verified");
        else if (data.status === "revoked") setStatus("revoked");
        else if (data.status === "not_current") setStatus("not-current");
        else setStatus("not-recognised");
      })
      .catch((error) => {
        if (cancelled) return;
        setCheckedAt(new Date());
        const code = error.response?.status;
        setStatus(code === 429 ? "rate-limited" : "unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [token, readFailed, attempt]);

  const checked = formatTimestamp(checkedAt);
  const reference = result?.certificate_reference;
  const retry = () => setAttempt((value) => value + 1);

  return (
    <PublicVerificationLayout>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-[#173D35]">Bursary certificate verification</h1>
        <p className="mt-1 text-sm text-slate-600">Scanned SBMS bursary award certificate</p>
      </div>

      {status === "loading" && <div className="mt-8"><LoadingState message="Checking this certificate..." /></div>}

      {status === "verified" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="success" icon={BadgeCheck}>Verified</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">This certificate was issued by SBMS</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              The certificate below matches an approved bursary award recorded in the Student
              Beneficiary Management System. It is a genuine SBMS certificate.
            </p>
          </div>
          <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Award period" value={result?.award_period} />
            <DetailRow label="Award approved on" value={formatTimestamp(result?.award_approved_at)} />
            <DetailRow label="Certificate issued on" value={formatTimestamp(result?.issued_at)} />
            <DetailRow label="Issued by" value={result?.issuing_authority} />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <h3 className="text-sm font-semibold text-amber-900">Approval is not payment</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-amber-900">
              This result confirms that the bursary award was approved and the certificate was issued.
              It does not confirm that funds have been disbursed. Payment is recorded separately, and
              only the awarding office can confirm it.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">What to do next</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              <li>Match the certificate reference above with the reference printed on the certificate.</li>
              <li>Check that the award period and issue details agree with the printed document.</li>
              <li>Contact the awarding office to confirm payment or any change to the award.</li>
            </ul>
          </div>
        </div>
      )}

      {status === "revoked" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="danger" icon={ShieldX}>Revoked</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">This certificate has been revoked</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              SBMS issued this certificate, but it has since been revoked and is
              <strong> no longer valid</strong>. A printed or photographed copy must not be accepted as
              proof of an approved bursary award.
            </p>
          </div>
          <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Award period" value={result?.award_period} />
            <DetailRow label="Revoked on" value={formatTimestamp(result?.revoked_at)} />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <p className="text-sm leading-relaxed text-slate-700">
            Ask the awarding office whether a replacement certificate has been issued. The award
            record itself is separate from this certificate.
          </p>
        </div>
      )}

      {status === "not-current" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="warning" icon={AlertTriangle}>No longer current</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">This certificate no longer matches the award record</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              The certificate was issued by SBMS, but the award it certifies has changed since then,
              so the printed document can no longer be relied on. Ask the awarding office to confirm
              the current award and to issue a replacement certificate if appropriate.
            </p>
          </div>
          <dl className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-2">
            <DetailRow label="Certificate reference" value={reference} mono />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
        </div>
      )}

      {status === "not-recognised" && (
        <div className="mt-6 space-y-5">
          <StatusBadge tone="danger" icon={ShieldQuestion}>Not recognised</StatusBadge>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">We could not verify this certificate</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              No SBMS-issued certificate matches this code. A QR code that was generated by hand,
              copied from another document or altered after printing cannot pass verification.
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">What to do next</h3>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-700">
              <li>Scan the QR code printed on the certificate itself, in good light.</li>
              <li>Check that the code has not been cropped, redrawn or replaced.</li>
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
              Certificate verification is rate limited to protect the service. No result was produced
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


    </PublicVerificationLayout>
  );
}
