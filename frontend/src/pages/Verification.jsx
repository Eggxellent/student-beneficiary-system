import { useEffect, useState } from "react";
import { AlertTriangle, ShieldCheck, ShieldQuestion, WifiOff } from "lucide-react";
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

// Public page opened by scanning a student QR code. The backend deliberately answers with
// `{ found: true | false }` and nothing else, so this page communicates a verification result
// without asking for - or implying the existence of - beneficiary details.
export default function Verification() {
  const { token, readFailed } = useHashToken();
  const [status, setStatus] = useState("loading");
  const [checkedAt, setCheckedAt] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (readFailed || !token) {
      setStatus("invalid");
      return undefined;
    }

    let cancelled = false;
    setStatus("loading");

    // The API is a separate origin in production (VITE_API_ORIGIN), and the SPA host does not
    // proxy /api/, so this request must go through the shared client rather than a relative
    // fetch - a relative call is answered by IIS with a 404 and every scan looks invalid.
    api
      .post("/verify", { token })
      .then((response) => {
        if (cancelled) return;
        setCheckedAt(new Date());
        setStatus(response.data?.found === true ? "found" : "invalid");
      })
      .catch((error) => {
        if (cancelled) return;
        setCheckedAt(new Date());
        const code = error.response?.status;
        if (code === 429) setStatus("rate-limited");
        // A refused token is a normal answer, not an outage; everything else is reported as one.
        else if (code && code < 500) setStatus("invalid");
        else setStatus("unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, [token, readFailed, attempt]);

  return (
    <PublicVerificationLayout>
      <div className="sb-stack sb-stack--tight">
        <span className="sb-eyebrow">Public verification</span>
        <h1 className="sb-title">Student record verification</h1>
        <p className="sb-subtitle">Scanned SBMS student QR code</p>
      </div>

      {status === "loading" && (
        <div style={{ marginTop: 24 }}>
          <LoadingState message="Checking this code…" />
          <div className="sb-skeleton sb-skeleton--line" style={{ marginTop: 16, width: "82%" }} aria-hidden="true" />
          <div className="sb-skeleton sb-skeleton--line" style={{ width: "58%" }} aria-hidden="true" />
        </div>
      )}

      {status === "found" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="success" icon={ShieldCheck}>
            Record found
          </StatusBadge>
          <p className="sb-subtitle">This code matches a student record held by the awarding office.</p>
          <dl className="sb-dl">
            <DetailRow label="Result" value="Student record exists" />
            <DetailRow label="Checked" value={checked ? `${checked} (device time)` : null} />
          </dl>
          <p className="sb-hint">
            Confirms the record exists only — not identity, eligibility, approval or payment. A bursary
            certificate has its own QR code. Confirm identity with the awarding office before releasing funds.
          </p>
        </div>
      )}

      {status === "invalid" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="danger" icon={ShieldQuestion}>
            Not verified
          </StatusBadge>
          <p className="sb-subtitle">
            No student record matches this code. It may be damaged or belong to another system; this does not
            prove a person is not registered.
          </p>
          <p className="sb-hint">
            Scan again in good light, check you scanned the student QR code, or ask the awarding office to
            confirm directly.
          </p>
          {checked && <p className="sb-meta">Checked at {checked} (device time).</p>}
        </div>
      )}

      {status === "rate-limited" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="warning" icon={AlertTriangle}>
            Please wait
          </StatusBadge>
          <p className="sb-subtitle">
            Too many checks in a short time, so this code was not checked. Wait a few minutes and try again.
          </p>
          <RetryButton onClick={() => setAttempt((value) => value + 1)}>Try again</RetryButton>
        </div>
      )}

      {status === "unavailable" && (
        <div className="sb-stack" style={{ marginTop: 22 }}>
          <StatusBadge tone="warning" icon={WifiOff}>
            Connection problem
          </StatusBadge>
          <p className="sb-subtitle">
            The verification service could not be reached, so this code was <strong>not</strong> checked.
          </p>
          <RetryButton onClick={() => setAttempt((value) => value + 1)} />
        </div>
      )}
    </PublicVerificationLayout>
  );
}


  const checked = formatTimestamp(checkedAt);
