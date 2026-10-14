import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Plus, Users } from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function FieldOfficerDashboard() {
  const { user } = useAuth();

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="border-b border-slate-200 pb-6">
        <p className="text-xs font-semibold uppercase text-emerald-700">Field operations</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          Welcome, {user?.full_name?.split(" ")[0] || "Field Officer"}
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Register students and assess bursary eligibility.
        </p>
      </header>

      <section aria-label="Field workflows" className="mt-6 divide-y divide-slate-200 border-y border-slate-200">
        <Link to="/students/register" className="group flex items-center justify-between gap-4 py-6">
          <span className="flex items-center gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-50 text-blue-700">
              <Plus size={19} aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold text-slate-900">Register a student</span>
              <span className="mt-1 block text-sm text-slate-600">Capture student and household information.</span>
            </span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-blue-700" aria-hidden="true" />
        </Link>

        <Link to="/eligibility" className="group flex items-center justify-between gap-4 py-6">
          <span className="flex items-center gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <BadgeCheck size={19} aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold text-slate-900">Assess eligibility</span>
              <span className="mt-1 block text-sm text-slate-600">Calculate a bursary eligibility score.</span>
            </span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-emerald-700" aria-hidden="true" />
        </Link>

        <Link to="/students" className="group flex items-center justify-between gap-4 py-6">
          <span className="flex items-center gap-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-slate-700">
              <Users size={19} aria-hidden="true" />
            </span>
            <span>
              <span className="block font-semibold text-slate-900">View students</span>
              <span className="mt-1 block text-sm text-slate-600">Find and review registered student records.</span>
            </span>
          </span>
          <ArrowRight size={18} className="shrink-0 text-slate-400 transition group-hover:translate-x-1 group-hover:text-slate-700" aria-hidden="true" />
        </Link>
      </section>
    </main>
  );
}