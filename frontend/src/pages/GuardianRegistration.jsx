import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, GraduationCap } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { GUARDIAN_PATHS } from "../components/GuardianChrome";
import { registerGuardian, apiErrorMessage } from "../services/guardian";

// Guardian self-registration (page 1 of the guardian interface). Submitting creates the guardian
// account through POST /api/guardian/register and signs the new guardian in with the shared
// /api/auth/login endpoint, so the token storage path is identical to the staff sign-in.

const ACCOUNT_TYPES = [
  { label: "Parent", value: "parent" },
  { label: "Legal Guardian", value: "legal_guardian" },
  { label: "Adult Student (18+)", value: "adult_student" },
  { label: "Authorised Caregiver", value: "authorised_caregiver" },
];

const LABEL_CLASS = "font-medium text-foreground text-sm";
const FIELD_CLASS = "rounded-md bg-card text-sm border border-input px-3 h-11 w-full text-foreground";

function RequiredMark() {
  return <span className="text-destructive">*</span>;
}

function Section({ legend, children }) {
  return (
    <fieldset className="border-0 m-0 p-0">
      <legend className="font-semibold text-foreground text-base mb-5">{legend}</legend>
      {children}
    </fieldset>
  );
}

function Divider() {
  return <hr className="border-0 border-t border-border my-8" />;
}

function PasswordField({ id, name, label, placeholder, visible, onToggle }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className={LABEL_CLASS}>
        {label} <RequiredMark />
      </label>
      <div className="flex items-center rounded-md bg-card border border-input h-11 focus-within:border-secondary">
        <input
          id={id}
          name={name}
          placeholder={placeholder}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          minLength={8}
          required
          className="h-full w-full rounded-md bg-transparent text-sm px-3 pr-12 outline-none"
        />
        <button
          type="button"
          aria-label={`${visible ? "Hide" : "Show"} ${label.toLowerCase()}`}
          aria-pressed={visible}
          onClick={onToggle}
          className="-ml-11 grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <Eye className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function GuardianRegistration() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    setError("");

    const email = form.email.value.trim();
    const password = form.password.value;
    if (password !== form.confirmPassword.value) {
      setError("Passwords do not match.");
      return;
    }

    setSubmitting(true);
    try {
      await registerGuardian({
        full_name: form.fullName.value.trim(),
        email,
        password,
        phone: form.phone.value.trim(),
        national_id: form.nationalId.value.trim(),
        relationship_to_student: form.accountType.value,
        privacy_consent: form.privacyConsent.checked,
      });
      await login(email, password);
      navigate(GUARDIAN_PATHS.dashboard);
    } catch (err) {
      setError(apiErrorMessage(err, "Account creation failed. Please check your details and try again."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-background text-foreground w-full min-h-screen overflow-x-hidden">
      <header className="bg-card border-b border-border flex flex-wrap px-4 sm:px-6 lg:px-12 justify-between items-center min-h-20 py-4 gap-4">
        <div aria-label="SBMS graduation-cap logo" className="flex items-center gap-3 min-w-0">
          <div className="rounded-lg bg-primary text-primary-foreground flex justify-center items-center size-10 shrink-0">
            <GraduationCap className="size-5" aria-hidden="true" />
          </div>
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2 min-w-0">
            <span className="font-semibold text-primary text-xl tracking-tight">SBMS</span>
            <span className="font-medium uppercase text-muted-foreground text-[10px] sm:text-xs tracking-widest">
              Student Beneficiary Management System
            </span>
          </div>
        </div>

        <div className="text-muted-foreground text-sm flex items-center gap-2">
          <span>Already have an account?</span>
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </div>
      </header>

      <main className="flex px-4 sm:px-6 py-8 sm:py-12 justify-center items-start min-h-[calc(100vh-5rem)]">
        <div className="shadow-sm bg-card border border-border rounded-xl w-full max-w-2xl">
          <div className="border-b border-border px-5 sm:px-10 pt-7 sm:pt-9 pb-7 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary w-8 h-1.5" />
              <span className="font-semibold uppercase text-muted-foreground text-xs tracking-widest">
                Account Registration
              </span>
            </div>

            <h1 className="font-semibold text-foreground text-2xl sm:text-3xl tracking-tight pt-2">
              Create Your Account
            </h1>

            <p className="text-muted-foreground text-sm leading-6 max-w-xl">
              Register to access and manage bursary applications through SBMS.
            </p>

            <p className="text-muted-foreground text-sm leading-6">
              One account can manage applications for multiple children or your own application as an
              adult student.
            </p>
          </div>

          <div className="px-5 sm:px-10 py-7 sm:py-8">
            <Section legend="Account Holder Information">
              <div className="grid gap-5 grid-cols-1 md:grid-cols-2">
                <div className="grid gap-2">
                  <label htmlFor="full-name" className={LABEL_CLASS}>
                    Full Legal Name <RequiredMark />
                  </label>
                  <input
                    id="full-name"
                    name="fullName"
                    placeholder="Enter your full legal name"
                    type="text"
                    autoComplete="name"
                    required
                    className={FIELD_CLASS}
                  />
                </div>

                <div className="grid gap-2">
                  <label htmlFor="account-type" className={LABEL_CLASS}>
                    I am registering as <RequiredMark />
                  </label>
                  <select
                    id="account-type"
                    name="accountType"
                    defaultValue=""
                    required
                    className={FIELD_CLASS}
                  >
                    <option value="" disabled>
                      Select account type
                    </option>
                    {ACCOUNT_TYPES.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <label htmlFor="national-id" className={LABEL_CLASS}>
                    National ID / Passport Number <RequiredMark />
                  </label>
                  <input
                    id="national-id"
                    name="nationalId"
                    placeholder="Enter ID or passport number"
                    type="text"
                    autoComplete="off"
                    required
                    className={FIELD_CLASS}
                  />
                </div>

                <div className="grid gap-2">
                  <label htmlFor="phone" className={LABEL_CLASS}>
                    Phone Number <RequiredMark />
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    placeholder="+254 7XX XXX XXX"
                    type="tel"
                    autoComplete="tel"
                    required
                    className={FIELD_CLASS}
                  />
                  <p className="text-muted-foreground text-xs">
                    Use a phone number you can access for account communication.
                  </p>
                </div>

                <div className="grid gap-2 md:col-span-2">
                  <label htmlFor="email" className={LABEL_CLASS}>
                    Email Address <RequiredMark />
                  </label>
                  <input
                    id="email"
                    name="email"
                    placeholder="Enter your email address"
                    type="email"
                    autoComplete="email"
                    required
                    className={FIELD_CLASS}
                  />
                </div>
              </div>
            </Section>

            <Divider />

            <Section legend="Account Security">
              <div className="grid gap-5 grid-cols-1 md:grid-cols-2">
                <div className="grid gap-2">
                  <PasswordField
                    id="password"
                    name="password"
                    label="Password"
                    placeholder="Create a password"
                    visible={showPassword}
                    onToggle={() => setShowPassword((value) => !value)}
                  />
                  <p className="text-muted-foreground text-xs leading-5">
                    Use a strong password with at least 8 characters.
                  </p>
                </div>

                <PasswordField
                  id="confirm-password"
                  name="confirmPassword"
                  label="Confirm Password"
                  placeholder="Re-enter your password"
                  visible={showConfirmPassword}
                  onToggle={() => setShowConfirmPassword((value) => !value)}
                />
              </div>
            </Section>

            <Divider />

            <div className="flex items-start gap-3">
              <input
                id="privacy-consent"
                name="privacyConsent"
                type="checkbox"
                required
                className="mt-1 size-4 shrink-0 accent-primary"
              />
              <label
                htmlFor="privacy-consent"
                className="font-normal text-muted-foreground text-sm leading-6"
              >
                I agree to the{" "}
                <a href="#" className="font-medium text-primary hover:underline">
                  Privacy Notice
                </a>{" "}
                and confirm that the information I have provided is accurate and truthful.{" "}
                <RequiredMark />
              </label>
            </div>

            {error && (
              <p role="alert" className="mb-5 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            )}

            <div className="mt-8">
              <button
                type="submit"
                disabled={submitting}
                className="font-semibold rounded-md bg-primary text-primary-foreground text-sm w-full h-11 hover:bg-secondary disabled:opacity-60"
              >
                {submitting ? "Creating account..." : "Create Account"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </form>
  );
}
