import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, KeyRound } from "lucide-react";
import { useAuth } from "../context/AuthContext";

// Reset links are handed over by an administrator as a URL, but people paste whatever they were
// given: the whole link, the path, or just the 64-character token. Accept all three and reject
// anything else, so the reset page never receives a malformed value.
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;

function extractToken(value) {
  const raw = value.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) {
    try {
      const token = new URL(raw).searchParams.get("token") || "";
      return TOKEN_PATTERN.test(token) ? token.toLowerCase() : "";
    } catch {
      return "";
    }
  }
  const plain = raw.replace(/^.*[?&]token=/, "").replace(/[?#].*$/, "");
  return TOKEN_PATTERN.test(plain) ? plain.toLowerCase() : "";
}

function Brand() {
  return (
    <div className="sbms-login-brand">
      <span className="sbms-login-brand-mark" aria-hidden="true">S</span>
      <span>SBMS</span>
    </div>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated, user, authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetValue, setResetValue] = useState("");
  const [resetError, setResetError] = useState("");
  const resetInput = useRef(null);

  useEffect(() => {
    if (!resetOpen) return undefined;
    resetInput.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape") setResetOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetOpen]);

  if (authLoading) return null;
  if (isAuthenticated) {
    const home = user?.role === "admin"
      ? "/dashboard"
      : user?.role === "guardian"
        ? "/guardian/dashboard"
        : "/field-officer";
    return <Navigate to={home} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting.current) return;

    submitting.current = true;
    setError("");
    setLoading(true);
    try {
      const account = await login(email, password);
      navigate(
        account.role === "admin"
          ? "/dashboard"
          : account.role === "guardian"
            ? "/guardian/dashboard"
            : "/field-officer"
      );
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Sign in failed. Check your email and password."
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  function openResetDialog() {
    setResetValue("");
    setResetError("");
    setResetOpen(true);
  }

  function submitResetLink(event) {
    event.preventDefault();
    const token = extractToken(resetValue);
    if (!token) {
      setResetError("That does not look like a reset link. Ask your administrator to issue a new one.");
      return;
    }
    setResetOpen(false);
    navigate(`/reset-password?token=${token}`);
  }

  return (
    <>
      <main className="sbms-login-screen">
        <section className="sbms-login-panel sbms-login-panel--narrow">
          <div className="sbms-auth-form-inner">
            <Brand />
            <h1 className="sbms-auth-heading">Sign in</h1>
            <p className="sbms-auth-subtitle">Enter your account details to continue.</p>


              {error && (
                <div className="sbms-login-error mb-4 p-3 rounded" role="alert">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} aria-busy={loading}>
                <label htmlFor="sbms-login-email" className="sbms-login-field sbms-login-field--first block mb-2 font-medium">
                  Email
                </label>
                <input
                  id="sbms-login-email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="sbms-login-input w-full border rounded p-2 mb-4"
                  placeholder="name@o365.strathmore.edu"
                  required
                />

                <label htmlFor="sbms-login-password" className="sbms-login-field block mb-2 font-medium">
                  Password
                </label>
                <div className="sbms-login-password mb-2">
                  <input
                    id="sbms-login-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="sbms-login-input w-full border rounded p-2 pr-10"
                    placeholder="Enter your password"
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

                <div className="sbms-auth-forgot-row">
                  <button type="button" onClick={openResetDialog} className="sbms-auth-forgot">
                    Forgot password?
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="sbms-login-submit w-full text-white py-2 rounded disabled:opacity-50"
                >
                  <span aria-live="polite">{loading ? "Signing in..." : "Sign in"}</span>
                </button>
              </form>

              <p className="sbms-auth-note sbms-auth-register">
                Don&apos;t have an account? <Link to="/guardian/register">Register here</Link>
              </p>
          </div>
        </section>
      </main>

      {resetOpen && (
        <div
          className="sbms-auth-dialog-backdrop"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setResetOpen(false); }}
        >
          <div className="sbms-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="sbms-reset-dialog-title">
            <span className="sbms-auth-dialog-icon" aria-hidden="true"><KeyRound size={20} /></span>
            <h2 id="sbms-reset-dialog-title">Reset your password</h2>
            <ol className="sbms-auth-steps">
              <li>Ask an administrator for a one-time reset link for your account.</li>
              <li>Open the link they hand you; it takes you to the new-password form.</li>
              <li>Choose a new password. The link works once and expires after 30 minutes.</li>
            </ol>

            <form onSubmit={submitResetLink}>
              <label htmlFor="sbms-reset-link" className="block mb-2 font-medium">Already have a reset link?</label>
              <input
                id="sbms-reset-link"
                ref={resetInput}
                value={resetValue}
                onChange={(event) => setResetValue(event.target.value)}
                className="sbms-login-input w-full border rounded p-2"
                placeholder="Paste the link or token"
                autoComplete="off"
                spellCheck={false}
              />
              {resetError && <p className="sbms-auth-dialog-error" role="alert">{resetError}</p>}
              <div className="sbms-auth-dialog-actions">
                <button type="button" onClick={() => setResetOpen(false)} className="sbms-auth-dialog-secondary">
                  Back to sign in
                </button>
                <button type="submit" className="sbms-auth-dialog-primary">
                  Open reset form <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

