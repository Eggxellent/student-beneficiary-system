import { useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { GUARDIAN_PATHS, GuardianLayout } from "../components/GuardianChrome";
import { useAuth } from "../context/AuthContext";
import { submitGuardianApplication, apiErrorMessage } from "../services/guardian";

// Guardian application form (page 3 of the guardian interface). Submitting POSTs the form to
// /api/guardian/applications, which stores the application against the signed-in guardian and
// returns a reference such as APP-2026-01004. Initial submissions carry no supporting documents:
// the form asks for student, school and household information only. Documents are requested later
// by an authorised officer through the More Info Required workflow when they are actually needed.

const CARD_CLASS = "rounded-xl border border-border bg-card shadow-sm";

// Shared control styling: same height, border and focus treatment as the guardian registration form.
const CONTROL_CLASS =
  "h-11 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:border-secondary focus:outline-none focus:ring-2 focus:ring-ring/30";

function FormCard({ title, description, children, contentClassName = "p-6" }) {
  return (
    <section className={`${CARD_CLASS} shadow-sm`}>
      <div className="border-b border-border px-6 py-5">
        <h2 className="text-lg font-semibold text-primary">{title}</h2>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className={contentClassName}>{children}</div>
    </section>
  );
}

function Field({ label, htmlFor, required = false, description, className = "", children }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children}
      {description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
    </div>
  );
}

function Input({ className = "", ...props }) {
  return <input className={`${CONTROL_CLASS} ${className}`} {...props} />;
}

// Native <select> with the chevron drawn by the wrapper: the project has no select component, and a
// native control keeps keyboard and mobile behaviour intact.
function Select({ id, name, defaultValue, options, required = false }) {
  return (
    <div className="relative">
      <select
        id={id}
        name={name || id}
        defaultValue={defaultValue}
        required={required}
        className={`${CONTROL_CLASS} appearance-none pr-10`}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  );
}

export default function NewApplication() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const guardianName = user?.full_name || "";
  const initials = guardianName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    setError("");

    const values = new FormData(event.currentTarget);
    const payload = {
      student_full_name: values.get("student-name"),
      student_date_of_birth: values.get("date-of-birth"),
      student_gender: values.get("gender"),
      student_identifier: values.get("student-id"),
      relationship_to_student: values.get("relationship"),
      school_name: values.get("school-name"),
      school_level: values.get("school-level"),
      admission_number: values.get("admission-number"),
      class_year: values.get("class-year"),
      school_county: values.get("school-county"),
      guardian_full_name: values.get("guardian-name"),
      guardian_phone: values.get("guardian-phone"),
      household_size: values.get("household-size"),
      income_source: values.get("income-source"),
      monthly_income: values.get("monthly-income"),
      // Eligibility inputs scored automatically after duplicate screening. The API coerces the
      // numeric strings; the selects submit the engine's own vocabulary values.
      fee_balance: values.get("fee-balance"),
      vulnerability_status: values.get("vulnerability-status"),
      siblings_in_school: values.get("siblings-in-school"),
      prior_bursary_history: values.get("prior-bursary-history"),
      declaration: values.get("declaration") === "on",
    };

    setSubmitting(true);
    try {
      const application = await submitGuardianApplication(payload);
      navigate(`${GUARDIAN_PATHS.myApplications}/${application.reference}`);
    } catch (err) {
      setError(apiErrorMessage(err, "Could not submit the application. Please check the form and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <GuardianLayout
      activeItem="new-application"
      guardianName={guardianName || "Guardian"}
      initials={initials || "GW"}
    >
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:p-10">
        <nav aria-label="Breadcrumb" className="mb-6">
          <ol className="flex flex-wrap items-center gap-2 text-sm">
            <li>
              <Link
                to={GUARDIAN_PATHS.dashboard}
                className="text-muted-foreground transition hover:text-foreground"
              >
                Dashboard
              </Link>
            </li>
            <li aria-hidden="true" className="text-muted-foreground">
              /
            </li>
            <li>
              <Link
                to={GUARDIAN_PATHS.myApplications}
                className="text-muted-foreground transition hover:text-foreground"
              >
                My Applications
              </Link>
            </li>
            <li aria-hidden="true" className="text-muted-foreground">
              /
            </li>
            <li aria-current="page" className="font-medium text-foreground">
              Application Form
            </li>
          </ol>
        </nav>

        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-muted-foreground">Bursary application</p>
          <h1 className="text-3xl font-semibold tracking-tight text-foreground">Application Form</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Complete the form below to apply for bursary assistance for one student.
          </p>
        </div>

        <div className="mb-8 flex items-start gap-3 rounded-lg border border-border bg-accent/60 px-5 py-4">
          <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-foreground">One student per application</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Each application is for one student. Submit a separate application for each child you
              are the parent or legal guardian of.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <FormCard
            title="Student Information"
            description="Provide details about the student applying for bursary assistance."
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field
                label="Student’s Full Legal Name"
                htmlFor="student-name"
                required
                className="md:col-span-2"
              >
                <Input
                  id="student-name"
                  name="student-name"
                  placeholder="Enter the student’s full legal name"
                />
              </Field>

              <Field label="Date of Birth" htmlFor="date-of-birth" required>
                <Input id="date-of-birth" name="date-of-birth" type="date" />
              </Field>

              <Field label="Gender" htmlFor="gender" required>
                <Select
                  id="gender"
                  defaultValue="female"
                  options={[
                    { value: "female", label: "Female" },
                    { value: "male", label: "Male" },
                    { value: "prefer-not-to-say", label: "Prefer not to say" },
                  ]}
                />
              </Field>

              <Field label="Birth Certificate Number" htmlFor="student-id">
                <Input
                  id="student-id"
                  name="student-id"
                  placeholder="Enter birth certificate number"
                />
              </Field>

              <Field label="Relationship to Student" htmlFor="relationship" required>
                <Select
                  id="relationship"
                  defaultValue="parent"
                  options={[
                    { value: "parent", label: "Parent" },
                    { value: "guardian", label: "Legal Guardian" },
                    { value: "caregiver", label: "Authorised Caregiver" },
                  ]}
                />
              </Field>
            </div>
          </FormCard>

          <FormCard
            title="School Information"
            description="Provide the student’s current school details."
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="School Name" htmlFor="school-name" required className="md:col-span-2">
                <Input id="school-name" name="school-name" placeholder="Enter the school name" />
              </Field>

              <Field label="School Level" htmlFor="school-level" required>
                <Select
                  id="school-level"
                  defaultValue="secondary"
                  options={[
                    { value: "primary", label: "Primary" },
                    { value: "secondary", label: "Secondary" },
                    { value: "college", label: "College" },
                    { value: "university", label: "University" },
                  ]}
                />
              </Field>

              <Field label="Admission / Registration Number" htmlFor="admission-number">
                <Input
                  id="admission-number"
                  name="admission-number"
                  placeholder="e.g. ADM-2025-0148"
                />
              </Field>

              <Field label="Current Class / Year of Study" htmlFor="class-year" required>
                <Input id="class-year" name="class-year" placeholder="e.g. Form 3 or Year 2" />
              </Field>

              <Field label="School County / Sub-County" htmlFor="school-county" required>
                <Input id="school-county" name="school-county" placeholder="e.g. Kiambu / Ruiru" />
              </Field>
            </div>
          </FormCard>

          <FormCard
            title="Parent and Household Information"
            description="Provide information about the household supporting this student."
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field label="Parent / Guardian Full Name" htmlFor="guardian-name" required>
                <Input
                  id="guardian-name"
                  name="guardian-name"
                  defaultValue={guardianName}
                  placeholder="Enter full name"
                />
              </Field>

              <Field label="Parent / Guardian Phone Number" htmlFor="guardian-phone" required>
                <Input
                  id="guardian-phone"
                  name="guardian-phone"
                  type="tel"
                  defaultValue={user?.phone || ""}
                  placeholder="e.g. 0712 345 678"
                />
              </Field>

              <Field label="Household Size" htmlFor="household-size" required>
                <Input
                  id="household-size"
                  name="household-size"
                  type="number"
                  min="1"
                  placeholder="Number of household members"
                />
              </Field>

              <Field label="Main Household Income Source" htmlFor="income-source" required>
                <Input
                  id="income-source"
                  name="income-source"
                  placeholder="e.g. Farming, business, employment"
                />
              </Field>

              <Field
                label="Approximate Monthly Household Income"
                htmlFor="monthly-income"
                required
                description="Use an approximate figure if your household income varies."
                className="md:col-span-2"
              >
                <Input
                  id="monthly-income"
                  name="monthly-income"
                  placeholder="Enter approximate amount in KES"
                />
              </Field>
            </div>
          </FormCard>

          <FormCard
            title="Bursary Eligibility Information"
            description="These five details are scored automatically to work out the student’s bursary need level."
          >
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <Field
                label="Outstanding School Fee Balance (KES)"
                htmlFor="fee-balance"
                required
                description="Total school fees still unpaid at the time of this application. Enter 0 if the fees are fully paid."
              >
                <Input
                  id="fee-balance"
                  name="fee-balance"
                  type="number"
                  min="0"
                  max="1000000000"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="e.g. 15000"
                />
              </Field>

              <Field
                label="Number of Siblings Currently in School"
                htmlFor="siblings-in-school"
                required
                description="Other children in the household attending school or college. Enter 0 if there are none."
              >
                <Input
                  id="siblings-in-school"
                  name="siblings-in-school"
                  type="number"
                  min="0"
                  max="20"
                  step="1"
                  inputMode="numeric"
                  placeholder="e.g. 2"
                />
              </Field>

              <Field
                label="Vulnerability Status"
                htmlFor="vulnerability-status"
                required
                description="Low: stable household. Medium: some hardship, such as illness or irregular income. High: severe hardship, such as orphanhood, disability or extreme poverty."
              >
                <Select
                  id="vulnerability-status"
                  required
                  options={[
                    { value: "", label: "Select vulnerability status" },
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                />
              </Field>

              <Field
                label="Prior Bursary History"
                htmlFor="prior-bursary-history"
                required
                description="Whether this student has received bursary assistance before."
              >
                <Select
                  id="prior-bursary-history"
                  required
                  options={[
                    { value: "", label: "Select prior bursary history" },
                    { value: "none", label: "No – no previous bursary" },
                    { value: "low", label: "Yes – limited assistance" },
                    { value: "high", label: "Yes – substantial assistance" },
                  ]}
                />
              </Field>
            </div>
          </FormCard>

          <FormCard title="Declaration">
            <div className="flex items-start gap-3">
              <input
                id="declaration"
                name="declaration"
                type="checkbox"
                required
                className="mt-0.5 size-4 shrink-0 rounded border-input accent-primary focus:outline-none focus:ring-2 focus:ring-ring/30"
              />
              <div>
                <label htmlFor="declaration" className="block text-sm leading-6 text-foreground">
                  I confirm that the information provided in this application is accurate and complete
                  to the best of my knowledge, and I understand that once submitted, this application
                  cannot be edited by me.{" "}
                  <span className="text-destructive" aria-hidden="true">
                    *
                  </span>
                </label>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
                  The information submitted may be reviewed by authorised SBMS officers as part of the
                  bursary assessment process. Any necessary corrections after submission must be
                  handled by an authorised officer.
                </p>
              </div>
            </div>
          </FormCard>

          {error && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-5 py-4 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
          </div>
        </form>
      </main>
    </GuardianLayout>
  );
}
