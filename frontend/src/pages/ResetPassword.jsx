import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldAlert } from "lucide-react";
import api from "../services/api";

// The page an administrator's one-time reset link opens. It checks the link before showing the form,
// so an expired or already-used link explains itself instead of failing on submit. The backend is the
// authority on all three rules (unused, unexpired, matching account); this page only renders them.
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

export default function ResetPassword() {
  const token = (new URLSearchParams(window.location.search).get("token") || "").trim().toLowerCase();
  const usable = TOKEN_PATTERN.test(token);

  const [status, setStatus] = useState(usable ? "checking" : "invalid");
  const [account, setAccount] = useState("");
  const [message, setMessage] = useState(
    usable ? "" : "This link is incomplete. Ask an administrator for a new password reset link."
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!usable) return undefined;
    let active = true;
    api.post("/auth/password-reset/validate", { token })
      .then(({ data }) => {
        if (!active) return;
        setAccount(data.account || "");
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        setMessage(err.response?.data?.message || "This password reset link is no longer valid.");
        setStatus("invalid");
      });
    return () => { active = false; };
  }, [token, usable]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The two passwords do not match.");
      return;
    }

    setSaving(true);
    try {
      await api.post("/auth/password-reset/complete", { token, password });
      setStatus("done");
    } catch (err) {
      const failure = err.response?.data?.message || "The password could not be saved. Try again.";
      if (err.response?.status === 410) {
        setMessage(failure);
        setStatus("invalid");
      } else {
        setError(failure);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="sbms-login-screen">
      <section className="sbms-login-panel sbms-login-panel--narrow">
        <div className="sbms-login-brand">
          <span className="sbms-login-brand-mark" aria-hidden="true">S</span>
          <span>Student Beneficiary<br />Management System</span>
        </div>

        {status === "checking" && (
          <p className="sbms-auth-subtitle" aria-live="polite">Checking your reset link...</p>
        )}

        {status === "invalid" && (
          <>
            <span className="sbms-auth-dialog-icon sbms-auth-dialog-icon--alert" aria-hidden="true"><ShieldAlert size={20} /></span>
            <h1 className="sbms-auth-heading">Reset link unavailable</h1>
            <p className="sbms-auth-subtitle">{message}</p>
            <p className="sbms-auth-note">
              Reset links are single use and expire 30 minutes after an administrator issues them. Ask for a
              new one and open it as soon as you receive it.
            </p>
            <Link to="/login" className="sbms-login-back mt-4 block text-center text-sm">Back to sign in</Link>
          </>
        )}

        {status === "ready" && (
          <>
            <h1 className="sbms-auth-heading">Choose a new password</h1>
            <p className="sbms-auth-subtitle">
              Setting the password for {account || "your account"}. The link stops working once you save.
            </p>

            {error && (
              <div className="sbms-login-error mb-4 p-3 rounded" role="alert">{error}</div>
            )}

            <form onSubmit={handleSubmit} aria-busy={saving}>
              <label htmlFor="sbms-reset-password" className="sbms-login-field block mb-2 font-medium">New password</label>
              <div className="sbms-login-password mb-4">
                <input
                  id="sbms-reset-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="sbms-login-input w-full border rounded p-2 pr-10"
                  placeholder="At least 8 characters"
                  minLength={8}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="sbms-login-password-toggle"
                >
                  {showPassword ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>

              <label htmlFor="sbms-reset-confirm" className="sbms-login-field block mb-2 font-medium">Confirm new password</label>
              <input
                id="sbms-reset-confirm"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="sbms-login-input w-full border rounded p-2 mb-6"
                placeholder="Repeat the new password"
                minLength={8}
                required
              />

              <button
                type="submit"
                disabled={saving}
                className="sbms-login-submit w-full text-white py-2 rounded disabled:opacity-50"
              >
                <span aria-live="polite">{saving ? "Saving..." : "Save new password"}</span>
              </button>
            </form>

            <p className="sbms-auth-note">
              <KeyRound size={15} aria-hidden="true" />
              Use at least 8 characters. Remember this password: the next reset needs a fresh link from an administrator.
            </p>
          </>
        )}

        {status === "done" && (
          <>
            <span className="sbms-auth-dialog-icon" aria-hidden="true"><CheckCircle2 size={20} /></span>
            <h1 className="sbms-auth-heading">Password updated</h1>
            <p className="sbms-auth-subtitle">Sign in with the new password. The reset link has been used up.</p>
            <Link to="/login" className="sbms-login-submit w-full text-white py-2 rounded block text-center">
              Back to sign in
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
