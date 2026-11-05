import { afterEach, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";

import { routeTree } from "@/routeTree.gen";
import type { MerchantProfile } from "@/lib/profile";

// Minimal fake of the SmartPay API, keyed by "METHOD /path". Every real route lives under /v1
// (URI versioning in the backend's main.ts), so the keys include it on purpose: a client that
// forgets the prefix hits "Unhandled request" and the test fails.
export type Handler = (body: unknown) => { status: number; json?: unknown } | "network-error";

// Mutated in place (never reassigned) so importing files always see the current contents.
export const routes: Record<string, Handler> = {};
export const calls: { key: string; init?: RequestInit }[] = [];

export const ME = "GET /v1/auth/me";
export const PROFILE = "GET /v1/merchants/profile";

export const unauth = () => ({ status: 401, json: { message: "Unauthorized" } });
export const me = { userId: "u-1", email: "merchant@example.com" };

export function profileFixture(overrides: Partial<MerchantProfile> = {}): MerchantProfile {
  return {
    id: "p-1",
    businessName: null,
    tradingName: null,
    businessType: null,
    supportEmail: null,
    supportPhone: null,
    city: null,
    district: null,
    accountStatus: "PENDING_SUBMISSION",
    rejectionReason: null,
    submittedAt: null,
    approvedAt: null,
    documents: [],
    ...overrides,
  };
}

/** Call once at the top level of a test file: installs the fake fetch around every test. */
export function installFakeApi() {
  beforeEach(() => {
    calls.length = 0;
    for (const k of Object.keys(routes)) delete routes[k];
    // Signed-in screens load the profile; tests that care override this.
    routes[PROFILE] = () => ({ status: 200, json: profileFixture() });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const key = `${init?.method ?? "GET"} ${new URL(url).pathname}`;
        calls.push({ key, init });
        const h = routes[key];
        if (!h) throw new Error(`Unhandled request ${key}`);
        const r = h(init?.body ? JSON.parse(String(init.body)) : undefined);
        if (r === "network-error") throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify(r.json ?? null), { status: r.status });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());
}

export function renderApp(path = "/") {
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(<RouterProvider router={router} />);
  return router;
}
