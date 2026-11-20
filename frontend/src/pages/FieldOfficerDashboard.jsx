import { Link } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function FieldOfficerDashboard() {
  const { user } = useAuth();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="border-b border-slate-200 pb-6">
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Welcome, {user?.full_name?.split(" ")[0] || "Field Officer"}
        </h1>
      </header>

      <section aria-label="Register student" className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
        <Link to="/students/register" className="group flex items-center justify-between gap-4 py-6">
          <span className="flex items-center gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <Plus size={19} aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold text-slate-900">Register student</span>
              <span className="mt-1 block text-sm text-slate-600">Enter student details.</span>
            </span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-blue-700" aria-hidden="true" />
        </Link>

      </section>
    </main>
  );
}
