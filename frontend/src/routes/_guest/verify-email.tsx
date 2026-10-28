import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { AuthLayout, Field, FormMessage } from "@/components/AuthLayout";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { genericErrorMessage } from "@/lib/messages";

// Reached from registration (?email=...) or from a login attempt on an unverified account (&reason=unverified).
export const Route = createFileRoute("/_guest/verify-email")({
  validateSearch: (search: Record<string, unknown>): { email?: string; reason?: "unverified" } => ({
    ...(typeof search.email === "string" && search.email ? { email: search.email } : {}),
    ...(search.reason === "unverified" ? { reason: "unverified" as const } : {}),
  }),
  head: () => ({ meta: [{ title: "Verify email — SmartPay Malawi" }] }),
  component: VerifyEmail,
});

function verifyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    // Also what the backend answers for an already-verified account, so mention logging in.
    if (err.status === 401)
      return "That code is wrong or has expired. Request a new one below. If you already verified, log in instead.";
    if (err.status === 400) return "Enter your email and the 6-digit code from the email.";
  }
  return genericErrorMessage(err);
}

function VerifyEmail() {
  const { verifyEmail, resendVerification } = useAuth();
  const navigate = useNavigate();
  const { email: emailFromSearch, reason } = Route.useSearch();
  const [email, setEmail] = useState(emailFromSearch ?? "");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // The backend allows one new code per minute and answers identically either way, so lock the button after a send.
  const [resent, setResent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      const signedIn = await verifyEmail(email.trim(), code);
      // A correct code verifies the email AND starts the session: straight to the merchant home page.
      // Only if the session couldn't be confirmed do we fall back to the login page.
      if (signedIn) await navigate({ to: "/home", replace: true });
      else await navigate({ to: "/", search: { verified: true }, replace: true });
    } catch (err) {
      setError(verifyErrorMessage(err));
      setSubmitting(false);
    }
  }

  async function onResend() {
    if (!email.trim()) {
      setError("Enter your email first, then request a new code.");
      return;
    }
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      await resendVerification(email.trim());
      setNotice("If that account is awaiting verification, a new code is on its way. Older codes no longer work.");
      setResent(true);
      window.setTimeout(() => setResent(false), 60_000);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 503
          ? "We couldn't send the email. Please try again."
          : genericErrorMessage(err),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={
        reason === "unverified"
          ? "Your email isn't verified yet. Enter the 6-digit code we sent you, or request a new one."
          : "Enter the 6-digit code we emailed you to finish creating your account and go to your home page."
      }
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        {notice && !error ? <FormMessage kind="success">{notice}</FormMessage> : null}
        {error ? <FormMessage kind="error">{error}</FormMessage> : null}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Field
          label="Verification code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456"
          pattern="\d{6}"
          maxLength={6}
          required
          autoFocus={Boolean(emailFromSearch)}
        />
        <button type="submit" className="btn-primary mt-2 disabled:opacity-60" disabled={submitting}>
          {submitting ? "Verifying…" : "Verify email"}
        </button>
      </form>
      <div className="mt-6 flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <button
          type="button"
          onClick={onResend}
          disabled={submitting || resent}
          className="font-semibold text-foreground underline underline-offset-4 disabled:opacity-60"
        >
          Send a new code
        </button>
        <Link to="/" className="underline underline-offset-4">
          Back to log in
        </Link>
      </div>
    </AuthLayout>
  );
}
