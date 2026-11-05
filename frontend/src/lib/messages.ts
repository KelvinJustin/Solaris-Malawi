import { ApiError, NetworkError } from "./api";

/** Fallback wording for failures every auth form can hit. Forms handle their own 400/401/409 first. */
export function genericErrorMessage(err: unknown): string {
  if (err instanceof NetworkError) return "Can't reach the server. Check your connection and try again.";
  // ArcjetGuard rate limit (60 requests/min/IP).
  if (err instanceof ApiError && err.status === 429) return "Too many attempts. Wait a minute, then try again.";
  return "Something went wrong on our side. Please try again.";
}

/** Wording for a failed page load (a GET that feeds a screen), shown in <ErrorState>. */
export function loadErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 404) return "We couldn't find this information. Try again, and contact support if it keeps happening.";
    if (err.status === 403) return "You don't have access to this.";
  }
  return genericErrorMessage(err);
}
