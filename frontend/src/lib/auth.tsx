import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";

export type Merchant = { userId: string; email: string };

export type RegisterInput = { name: string; email: string; password: string; phone: string };

type Status =
  | "loading" // checking the session with GET /auth/me
  | "authenticated"
  | "unauthenticated" // server said 401
  | "error"; // network/server failure: we do NOT know whether the session is valid

type AuthContextValue = {
  status: Status;
  merchant: Merchant | null;
  /** Step 1 of login: checks the password and emails a one-time code. Does NOT start a session. */
  login: (email: string, password: string) => Promise<void>;
  /** Step 2 of login: checks the emailed code. The server sets the cookie, then we load the identity. */
  verifyLogin: (email: string, code: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  /**
   * Final step of registration: confirms the email with the emailed code. The server also starts the
   * session (HTTP-only cookie). Resolves true when the session is confirmed (go to /home), or false if the
   * email was verified but the session could not be confirmed (send the merchant to log in).
   */
  verifyEmail: (email: string, code: string) => Promise<boolean>;
  /** Emails a fresh verification code (the backend answers the same whether or not the account exists). */
  resendVerification: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  /**
   * Call when ANY authenticated request answers 401 (token expired or revoked mid-session).
   * Drops the local identity so the app returns to the login page.
   */
  expireSession: () => void;
  retry: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * POST /auth/login answers 401 both for a bad password and for "email not verified yet",
 * and only the message differs. The UI needs to tell them apart to send the merchant to the
 * verification screen instead of saying "wrong password".
 */
export function isEmailNotVerified(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401 && /verify your email/i.test(err.message);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [merchant, setMerchant] = useState<Merchant | null>(null);

  // Restore the session. 401 = logged out; anything else = unknown (don't assume expired).
  const restore = useCallback(async () => {
    setStatus("loading");
    try {
      setMerchant(await api<Merchant>("/auth/me"));
      setStatus("authenticated");
    } catch (err) {
      setMerchant(null);
      setStatus(err instanceof ApiError && err.status === 401 ? "unauthenticated" : "error");
    }
  }, []);

  useEffect(() => {
    void restore();
  }, [restore]);

  const login = useCallback(async (email: string, password: string) => {
    // No cookie is issued here, so the status must stay "unauthenticated" until verifyLogin succeeds.
    await api("/auth/login", { method: "POST", body: { email, password } });
  }, []);

  const verifyLogin = useCallback(async (email: string, code: string) => {
    // The server sets the HTTP-only access_token cookie. The response body also contains the JWT,
    // but it is deliberately ignored: the token is never read, stored or sent by JavaScript.
    await api("/auth/verify-login", { method: "POST", body: { email, code } });
    // The response carries no identity, so ask the server who we are.
    setMerchant(await api<Merchant>("/auth/me"));
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    // Registration does not create a session; the caller sends the merchant to verify their email.
    await api("/auth/register", { method: "POST", body: input });
  }, []);

  const verifyEmail = useCallback(async (email: string, code: string) => {
    // Throws if the code is wrong. On success the server has verified the email and set the cookie.
    await api("/auth/verify-email", { method: "POST", body: { email, code } });
    // The response carries no identity, so ask the server who we are (same as verifyLogin).
    try {
      setMerchant(await api<Merchant>("/auth/me"));
      setStatus("authenticated");
      return true;
    } catch {
      // The email IS verified now (the code is spent), so don't surface an error: the caller falls back to login.
      return false;
    }
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    await api("/auth/resend-verification", { method: "POST", body: { email } });
  }, []);

  const logout = useCallback(async () => {
    // Only reset local state once the server confirms: the backend is what revokes the token and
    // clears the cookie, so a failed request means the session may still be valid. Errors propagate.
    await api("/auth/logout", { method: "POST" });
    setMerchant(null);
    setStatus("unauthenticated");
  }, []);

  const expireSession = useCallback(() => {
    setMerchant(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({
      status,
      merchant,
      login,
      verifyLogin,
      register,
      verifyEmail,
      resendVerification,
      logout,
      expireSession,
      retry: () => void restore(),
    }),
    [status, merchant, login, verifyLogin, register, verifyEmail, resendVerification, logout, expireSession, restore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
