import { useRef, useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthLayout, Field, FormMessage } from "@/components/AuthLayout";
import { ApiError } from "@/lib/api";
import { isEmailNotVerified, useAuth } from "@/lib/auth";
import { genericErrorMessage } from "@/lib/messages";

// The login page is the main page of the app.
export const Route = createFileRoute("/_guest/")({
  validateSearch: (search: Record<string, unknown>): { verified?: true } =>
    search.verified === true || search.verified === "true" ? { verified: true } : {},
  head: () => ({ meta: [{ title: "Log in — SmartPay Malawi" }] }),
  component: Login,
});

// Login is two steps: 1) email + password -> a code is emailed, 2) the code -> the session cookie.
type Step = { kind: "credentials" } | { kind: "code"; email: string };

function passwordStepError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "Incorrect email or password.";
    if (err.status === 400) return err.message;
    if (err.status === 503) return "We couldn't send your login code. Please try again.";
  }
  return genericErrorMessage(err);
}

function codeStepError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return "That code is wrong or has expired. Use “Send a new code” to get a fresh one.";
    if (err.status === 400) return "Enter the 6-digit code from your email.";
  }
  return genericErrorMessage(err);
}

function Login() {
  const { login, verifyLogin, resendVerification } = useAuth();
  const navigate = useNavigate();
  const { verified } = Route.useSearch();
  const [step, setStep] = useState<Step>({ kind: "credentials" });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Kept in memory only so "Send a new code" can repeat step 1. Never persisted, cleared when done.
  const passwordRef = useRef("");

  async function onSubmitCredentials(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await login(email, password);
      passwordRef.current = password;
      setStep({ kind: "code", email });
    } catch (err) {
      if (isEmailNotVerified(err)) {
        // The password was right but the email was never confirmed: email a fresh verification code
        // before landing on that screen. Best effort (the backend rate-limits to one per minute and the
        // screen has its own "Send a new code" button), so a failure here must not block the redirect.
        await resendVerification(email).catch(() => undefined);
        await navigate({ to: "/verify-email", search: { email, reason: "unverified" } });
        return;
      }
      setError(passwordStepError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "code") return;
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await verifyLogin(step.email, code);
      passwordRef.current = "";
      await navigate({ to: "/home", replace: true });
    } catch (err) {
      setError(codeStepError(err));
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (step.kind !== "code") return;
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await login(step.email, passwordRef.current);
      setNotice("We sent a new code. Any earlier code no longer works.");
    } catch (err) {
      setError(passwordStepError(err));
    } finally {
      setSubmitting(false);
    }
  }

  function onBack() {
    passwordRef.current = "";
    setError(null);
    setNotice(null);
    setStep({ kind: "credentials" });
  }

  if (step.kind === "code") {
    return (
      <AuthLayout title="Check your email" subtitle={`We sent a 6-digit login code to ${step.email}.`}>
        {/* key forces a fresh form: otherwise React reuses the step-1 email <input> node and the
            code box would come up pre-filled with the email address. */}
        <form key="code-step" className="space-y-4" onSubmit={onSubmitCode}>
          {notice && !error ? <FormMessage kind="success">{notice}</FormMessage> : null}
          {error ? <FormMessage kind="error">{error}</FormMessage> : null}
          <Field
            label="Login code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            pattern="\d{6}"
            maxLength={6}
            required
            autoFocus
          />
          <button type="submit" className="btn-primary mt-2 disabled:opacity-60" disabled={submitting}>
            {submitting ? "Checking…" : "Verify and log in"}
          </button>
        </form>
        <div className="mt-6 flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <button
            type="button"
            onClick={onResend}
            disabled={submitting}
            className="font-semibold text-foreground underline underline-offset-4 disabled:opacity-60"
          >
            Send a new code
          </button>
          <button type="button" onClick={onBack} className="underline underline-offset-4">
            Use a different account
          </button>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="Welcome" subtitle="Enter your email and password to log in.">
      <form key="credentials-step" className="space-y-4" onSubmit={onSubmitCredentials}>
        {verified && !error ? <FormMessage kind="success">Email verified. Log in to continue.</FormMessage> : null}
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Field label="Email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
        <Field label="Password" name="password" type="password" autoComplete="current-password" placeholder="••••••••" required />
        <button type="submit" className="btn-primary mt-2 disabled:opacity-60" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New here?{" "}
        <Link to="/register" className="font-semibold text-foreground underline underline-offset-4">
          Create account
        </Link>
      </p>
    </AuthLayout>
  );
}
