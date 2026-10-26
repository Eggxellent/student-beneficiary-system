import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ArrowRight, ClipboardCheck, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Login({ role }) {
  const navigate = useNavigate();
  const { login, isAuthenticated, user, authLoading } = useAuth();
  const [selectedRole, setSelectedRole] = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const transitionTimer = useRef(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    window.clearTimeout(transitionTimer.current);
    transitionTimer.current = null;
    setSelectedRole(null);
    setTransitioning(false);
    setLeaving(false);
  }, [role]);

  useEffect(() => () => window.clearTimeout(transitionTimer.current), []);

  if (authLoading) return null;
  if (isAuthenticated) return <Navigate to={user?.role === "admin" ? "/dashboard" : "/field-officer"} replace />;

  function selectRole(event, nextRole) {
    event.preventDefault();
    if (transitioning || transitionTimer.current) return;
    setSelectedRole(nextRole);
    setTransitioning(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 260;
    transitionTimer.current = window.setTimeout(() => {
      transitionTimer.current = null;
      navigate(nextRole === "admin" ? "/admin/login" : "/field-officer/login");
    }, delay);
  }

  function changeRole(event) {
    event.preventDefault();
    if (transitioning || transitionTimer.current) return;
    setTransitioning(true);
    setLeaving(true);
    const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200;
    transitionTimer.current = window.setTimeout(() => {
      transitionTimer.current = null;
      navigate("/login");
    }, delay);
  }

  if (!role) {
    return <main className="sbms-login-screen sbms-login-screen--chooser" data-theme={selectedRole || "neutral"}>
      <section className={`sbms-login-panel sbms-login-panel--chooser${leaving ? " sbms-login-panel--leaving" : ""}`} aria-busy={transitioning}>
        <div className="sbms-login-brand">
          <span className="sbms-login-brand-mark" aria-hidden="true">S</span>
          <span>Student Beneficiary<br />Management System</span>
        </div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-2 text-slate-600">Choose your role.</p>
        <div className="sbms-login-choices mt-6 grid gap-4 sm:grid-cols-2">
          <Link to="/admin/login" onClick={(event) => selectRole(event, "admin")} aria-disabled={transitioning} data-role="admin" data-selected={selectedRole === "admin"} className="sbms-login-choice">
            <span className="sbms-login-choice-icon" aria-hidden="true"><ShieldCheck size={21} strokeWidth={1.8} /></span>
            <span className="sbms-login-choice-label"><span className="block text-lg font-semibold">Admin</span></span>
            <ArrowRight className="sbms-login-choice-arrow" size={18} aria-hidden="true" />
          </Link>
          <Link to="/field-officer/login" onClick={(event) => selectRole(event, "field_officer")} aria-disabled={transitioning} data-role="field_officer" data-selected={selectedRole === "field_officer"} className="sbms-login-choice">
            <span className="sbms-login-choice-icon" aria-hidden="true"><ClipboardCheck size={21} strokeWidth={1.8} /></span>
            <span className="sbms-login-choice-label"><span className="block text-lg font-semibold">Field Officer</span></span>
            <ArrowRight className="sbms-login-choice-arrow" size={18} aria-hidden="true" />
          </Link>
        </div>
        <span className="sr-only" aria-live="polite">{selectedRole && `${selectedRole === "admin" ? "Admin" : "Field Officer"} selected. Opening sign in.`}</span>
      </section>
    </main>;
  }

  const roleLabel = role === "admin" ? "Admin" : "Field Officer";

  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting.current) return;

    submitting.current = true;
    setError("");
    setLoading(true);

    try {
      const user = await login(email, password, role);
      navigate(user.role === "admin" ? "/dashboard" : "/field-officer");
    } catch (err) {
      setError(
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Login failed. Please check your details."
      );
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  }

  return (
    <main className="sbms-login-screen" data-theme={role}>
      <form
        onSubmit={handleSubmit}
        aria-busy={loading}
        className={`sbms-login-panel sbms-login-panel--form${leaving ? " sbms-login-panel--leaving" : ""}`}
      >
        <div className="sbms-login-brand">
          <span className="sbms-login-brand-mark" aria-hidden="true">S</span>
          <span>Student Beneficiary<br />Management System</span>
        </div>
        <h1 className="sbms-login-heading text-2xl font-bold mb-2">{roleLabel} sign in</h1>


        {error && (
          <div className="sbms-login-error mb-4 p-3 rounded" role="alert">
            {error}
          </div>
        )}

        <label htmlFor="sbms-login-email" className="sbms-login-field sbms-login-field--first block mb-2 font-medium">
          Email
        </label>

        <input
          id="sbms-login-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="sbms-login-input w-full border rounded p-2 mb-4"
          placeholder={role === "admin" ? "Admin email" : "Field Officer email"}
          required
        />

        <label htmlFor="sbms-login-password" className="sbms-login-field block mb-2 font-medium">
          Password
        </label>

        <input
          id="sbms-login-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="sbms-login-input w-full border rounded p-2 mb-6"
          placeholder="Enter password"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="sbms-login-submit w-full text-white py-2 rounded disabled:opacity-50"
        >
          <span aria-live="polite">{loading ? "Signing in..." : "Sign In"}</span>
        </button>
        <Link to="/login" onClick={changeRole} aria-disabled={transitioning} className="sbms-login-back mt-4 block text-center text-sm">Change role</Link>
      </form>
    </main>
  );
}
