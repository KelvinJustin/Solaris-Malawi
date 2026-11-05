// Thin fetch wrapper for the SmartPay API.
// The JWT lives in an HTTP-only cookie, so every request must send credentials.

// The backend mounts every route under a URI version prefix (see enableVersioning in src/main.ts),
// so the real base is <origin>/v1. VITE_API_URL is the origin only; "/v1" is added here, and is
// not duplicated if someone already put it in the env value.
const API_ORIGIN = (import.meta.env.VITE_API_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const API_VERSION = "v1";
export const API_URL = /\/v\d+$/.test(API_ORIGIN) ? API_ORIGIN : `${API_ORIGIN}/${API_VERSION}`;

/** The server answered with a non-2xx status. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** The request never got a response (server down, CORS failure, offline...). */
export class NetworkError extends Error {
  constructor() {
    super("Could not reach the SmartPay server.");
    this.name = "NetworkError";
  }
}

// NestJS validation errors look like { message: string | string[] }.
function extractMessage(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const m = (body as { message: unknown }).message;
    if (Array.isArray(m)) return m.join(". ");
    if (typeof m === "string") return m;
  }
  return fallback;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: init.method ?? "GET",
      credentials: "include",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new NetworkError();
  }

  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, extractMessage(body, "Something went wrong. Please try again."));
  return body as T;
}
