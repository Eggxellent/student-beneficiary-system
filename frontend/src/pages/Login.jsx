import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login({ role }) {
  const navigate = useNavigate();
  const { login, isAuthenticated, user, authLoading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (authLoading) return null;
  if (isAuthenticated) return <Navigate to={user?.role === "admin" ? "/dashboard" : "/field-officer"} replace />;

  if (!role) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-100 p-5">
      <section className="w-full max-w-2xl rounded-lg bg-white p-8 shadow">
        <h1 className="text-2xl font-bold">SBMS sign in</h1>
        <p className="mt-2 text-slate-600">Choose your account type to open the correct sign-in page.</p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Link to="/admin/login" className="rounded border border-blue-200 p-5 hover:bg-blue-50">
            <span className="block text-lg font-semibold">Admin</span>
            <span className="mt-1 block text-sm text-slate-600">System dashboard, user management and duplicate review.</span>
          </Link>
          <Link to="/field-officer/login" className="rounded border border-emerald-200 p-5 hover:bg-emerald-50">
            <span className="block text-lg font-semibold">Field Officer</span>
            <span className="mt-1 block text-sm text-slate-600">Student registration and field operations.</span>
          </Link>
        </div>
      </section>
    </main>;
  }

  const roleLabel = role === "admin" ? "Admin" : "Field Officer";

  async function handleSubmit(e) {
    e.preventDefault();

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
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={handleSubmit}
        className={`w-full max-w-md rounded-lg bg-white p-8 shadow ${role === "admin" ? "border-t-4 border-blue-600" : "border-t-4 border-emerald-600"}`}
      >
        <h1 className="text-2xl font-bold mb-2">{roleLabel} sign in</h1>

        <p className="text-gray-600 mb-6">
          Sign in to the {roleLabel} workspace with your assigned account.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}

        <label className="block mb-2 font-medium">
          Email
        </label>

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full border rounded p-2 mb-4"
          placeholder={role === "admin" ? "Admin email" : "Field Officer email"}
          required
        />

        <label className="block mb-2 font-medium">
          Password
        </label>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full border rounded p-2 mb-6"
          placeholder="Enter password"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in..." : "Sign In"}
        </button>
        <Link to="/login" className="mt-4 block text-center text-sm text-blue-700">Choose a different sign-in</Link>
      </form>
    </div>
  );
}
