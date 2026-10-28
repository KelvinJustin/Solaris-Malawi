import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ME, PROFILE, calls, installFakeApi, me, renderApp, routes, unauth } from "./harness";

installFakeApi();

/** Fakes a merchant who is logged out until POST /auth/verify-login accepts the code 123456. */
function fakeTwoStepLogin() {
  let loggedIn = false;
  routes[ME] = () => (loggedIn ? { status: 200, json: me } : unauth());
  routes["POST /v1/auth/login"] = (body) => {
    expect(body).toEqual({ email: "merchant@example.com", password: "secret123" });
    return { status: 201, json: { message: "Login verification code sent", email: "merchant@example.com" } };
  };
  routes["POST /v1/auth/verify-login"] = (body) => {
    const { code } = body as { code: string };
    if (code !== "123456") return { status: 401, json: { message: "Invalid or expired login verification code" } };
    loggedIn = true;
    // The real backend also returns { message }; the cookie (not modelled by fetch here) is what matters.
    return { status: 201, json: { message: "Login successful" } };
  };
}

async function submitCredentials(email = "merchant@example.com", password = "secret123") {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Email"), email);
  await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Log in" }));
  return user;
}

describe("API base URL", () => {
  it("sends every request under /v1 with credentials", async () => {
    routes[ME] = unauth;
    renderApp("/");
    await screen.findByRole("heading", { name: "Welcome" });
    expect(calls[0]!.key).toBe("GET /v1/auth/me");
    expect(calls.every((c) => c.key.split(" ")[1]!.startsWith("/v1/"))).toBe(true);
    expect(calls.every((c) => c.init?.credentials === "include")).toBe(true);
  });
});

describe("session restore", () => {
  it("shows the login page at / when /auth/me returns 401", async () => {
    routes[ME] = unauth;
    renderApp("/");
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
  });

  it("skips login and shows home when /auth/me succeeds (cookie restored on refresh)", async () => {
    routes[ME] = () => ({ status: 200, json: me });
    renderApp("/");
    expect(await screen.findByText("merchant@example.com")).toBeInTheDocument();
  });

  it("redirects a logged-out visitor from /home to the login page", async () => {
    routes[ME] = unauth;
    renderApp("/home");
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
  });

  it("treats a network failure as unknown, not as logged out", async () => {
    routes[ME] = () => "network-error";
    renderApp("/");
    expect(await screen.findByText("Can't reach SmartPay")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Welcome" })).not.toBeInTheDocument();
  });

  it("treats a 500 from /auth/me as unknown, not as logged out", async () => {
    routes[ME] = () => ({ status: 500, json: { message: "Internal server error" } });
    renderApp("/");
    expect(await screen.findByText("Can't reach SmartPay")).toBeInTheDocument();
  });
});

describe("login (two steps)", () => {
  it("step 1 asks for the emailed code and does NOT log in yet", async () => {
    fakeTwoStepLogin();
    renderApp("/");
    await submitCredentials();
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeInTheDocument();
    expect(screen.getByLabelText("Login code")).toBeInTheDocument();
    // No identity lookup and no dashboard until the code is accepted.
    expect(calls.map((c) => c.key)).toEqual([ME, "POST /v1/auth/login"]);
  });

  it("step 2 verifies the code, then fetches /auth/me and lands on home", async () => {
    fakeTwoStepLogin();
    renderApp("/");
    const user = await submitCredentials();
    await user.type(await screen.findByLabelText("Login code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and log in" }));
    expect(await screen.findByText("merchant@example.com")).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toEqual([
      ME,
      "POST /v1/auth/login",
      "POST /v1/auth/verify-login",
      ME,
      PROFILE, // the signed-in shell loads the account status
    ]);
    expect(calls[2]!.init?.credentials).toBe("include");
    expect(JSON.parse(String(calls[2]!.init?.body))).toEqual({ email: "merchant@example.com", code: "123456" });
  });

  it("never stores a token in web storage", async () => {
    fakeTwoStepLogin();
    renderApp("/");
    const user = await submitCredentials();
    await user.type(await screen.findByLabelText("Login code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and log in" }));
    await screen.findByText("merchant@example.com");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("shows a friendly message for wrong credentials (401)", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/login"] = () => ({ status: 401, json: { message: "Invalid email or password" } });
    renderApp("/");
    await submitCredentials("a@b.com", "wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });

  it("sends an unverified merchant to the verify-email screen and emails a fresh code", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/login"] = () => ({
      status: 401,
      json: { message: "Please verify your email before logging in" },
    });
    routes["POST /v1/auth/resend-verification"] = (body) => {
      expect(body).toEqual({ email: "merchant@example.com" });
      return { status: 200, json: { message: "If that account is awaiting verification, a new code has been sent" } };
    };
    renderApp("/");
    await submitCredentials();
    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("merchant@example.com");
    expect(screen.getByText(/isn't verified yet/)).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toContain("POST /v1/auth/resend-verification");
  });

  it("still reaches the verify-email screen if the automatic resend fails", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/login"] = () => ({
      status: 401,
      json: { message: "Please verify your email before logging in" },
    });
    routes["POST /v1/auth/resend-verification"] = () => "network-error";
    renderApp("/");
    await submitCredentials();
    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
  });

  it("explains a wrong or expired login code and stays on the code step", async () => {
    fakeTwoStepLogin();
    renderApp("/");
    const user = await submitCredentials();
    await user.type(await screen.findByLabelText("Login code"), "000000");
    await user.click(screen.getByRole("button", { name: "Verify and log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("wrong or has expired");
    expect(screen.getByLabelText("Login code")).toBeInTheDocument();
  });

  it("can request a new login code, repeating step 1", async () => {
    fakeTwoStepLogin();
    renderApp("/");
    const user = await submitCredentials();
    await user.click(await screen.findByRole("button", { name: "Send a new code" }));
    expect(await screen.findByRole("status")).toHaveTextContent("We sent a new code");
    expect(calls.filter((c) => c.key === "POST /v1/auth/login")).toHaveLength(2);
  });

  it("lets the merchant go back and use a different account", async () => {
    fakeTwoStepLogin();
    renderApp("/");
    const user = await submitCredentials();
    await user.click(await screen.findByRole("button", { name: "Use a different account" }));
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
  });

  it("reports a network failure on the code step without logging in", async () => {
    fakeTwoStepLogin();
    routes["POST /v1/auth/verify-login"] = () => "network-error";
    renderApp("/");
    const user = await submitCredentials();
    await user.type(await screen.findByLabelText("Login code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify and log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
    expect(screen.getByLabelText("Login code")).toBeInTheDocument();
  });
});

describe("register", () => {
  async function fillAndSubmit() {
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Business name"), "Example Business");
    await user.type(screen.getByLabelText("Email"), "merchant@example.com");
    await user.type(screen.getByLabelText("Phone number"), "+265 99 123 4567");
    await user.type(screen.getByLabelText("Password"), "ExamplePassword123!");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
  }

  it("sends the contract payload, then goes to verify-email with the address filled in", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/register"] = (body) => {
      expect(body).toEqual({
        name: "Example Business",
        email: "merchant@example.com",
        password: "ExamplePassword123!",
        phone: "+265991234567",
      });
      return { status: 201, json: { message: "Verification email sent", email: "merchant@example.com" } };
    };
    renderApp("/register");
    await fillAndSubmit();
    expect(await screen.findByRole("heading", { name: "Verify your email" })).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("merchant@example.com");
    expect(screen.getByLabelText("Verification code")).toBeInTheDocument();
  });

  it("explains a duplicate email or phone (409)", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/register"] = () => ({ status: 409, json: { message: "Conflict" } });
    renderApp("/register");
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("already registered");
  });

  it("shows backend validation messages (400, array form)", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/register"] = () => ({ status: 400, json: { message: ["phone must be a valid phone number"] } });
    renderApp("/register");
    await fillAndSubmit();
    expect(await screen.findByRole("alert")).toHaveTextContent("phone must be a valid phone number");
  });
});

describe("verify email", () => {
  it("verifies the code, starts the session and lands on the merchant home page", async () => {
    let loggedIn = false;
    routes[ME] = () => (loggedIn ? { status: 200, json: me } : unauth());
    routes["POST /v1/auth/verify-email"] = (body) => {
      expect(body).toEqual({ email: "merchant@example.com", code: "654321" });
      loggedIn = true; // the real server sets the HTTP-only cookie here
      return { status: 201, json: { message: "Email verified successfully" } };
    };
    renderApp("/verify-email?email=merchant%40example.com");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Verification code"), "654321");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByText("merchant@example.com")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
    expect(calls.map((c) => c.key)).toEqual([
      ME,
      "POST /v1/auth/verify-email",
      ME,
      PROFILE, // the signed-in shell loads the account status
    ]);
    expect(calls[1]!.init?.credentials).toBe("include");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("falls back to the login page (with a success note) if the session can't be confirmed after verifying", async () => {
    routes[ME] = unauth; // verification worked but /auth/me still answers 401
    routes["POST /v1/auth/verify-email"] = () => ({ status: 201, json: { message: "Email verified successfully" } });
    renderApp("/verify-email?email=merchant%40example.com");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Verification code"), "654321");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Email verified");
  });

  it("register -> emailed code -> home, end to end", async () => {
    let loggedIn = false;
    routes[ME] = () => (loggedIn ? { status: 200, json: me } : unauth());
    routes["POST /v1/auth/register"] = () => ({
      status: 201,
      json: { message: "Verification email sent", email: "merchant@example.com" },
    });
    routes["POST /v1/auth/verify-email"] = () => {
      loggedIn = true;
      return { status: 201, json: { message: "Email verified successfully" } };
    };
    renderApp("/register");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Business name"), "Example Business");
    await user.type(screen.getByLabelText("Email"), "merchant@example.com");
    await user.type(screen.getByLabelText("Phone number"), "+265 99 123 4567");
    await user.type(screen.getByLabelText("Password"), "ExamplePassword123!");
    await user.click(screen.getByRole("button", { name: "Sign up" }));
    await user.type(await screen.findByLabelText("Verification code"), "654321");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  });

  it("explains a wrong or expired code (401)", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/verify-email"] = () => ({
      status: 401,
      json: { message: "Invalid or expired verification code" },
    });
    renderApp("/verify-email?email=merchant%40example.com");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Verification code"), "111111");
    await user.click(screen.getByRole("button", { name: "Verify email" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("wrong or has expired");
  });

  it("requests a new code, shows a neutral confirmation, and locks the button", async () => {
    routes[ME] = unauth;
    routes["POST /v1/auth/resend-verification"] = (body) => {
      expect(body).toEqual({ email: "merchant@example.com" });
      return { status: 200, json: { message: "If that account is awaiting verification, a new code has been sent" } };
    };
    renderApp("/verify-email?email=merchant%40example.com");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Send a new code" }));
    expect(await screen.findByRole("status")).toHaveTextContent("a new code is on its way");
    expect(screen.getByRole("button", { name: "Send a new code" })).toBeDisabled();
  });

  it("asks for an email before requesting a code", async () => {
    routes[ME] = unauth;
    renderApp("/verify-email");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Send a new code" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter your email first");
    expect(calls.map((c) => c.key)).toEqual([ME]);
  });
});

describe("logout", () => {
  it("calls /auth/logout and returns to the login page", async () => {
    let loggedIn = true;
    routes[ME] = () => (loggedIn ? { status: 200, json: me } : unauth());
    routes["POST /v1/auth/logout"] = () => {
      loggedIn = false;
      return { status: 200, json: { message: "Logged out successfully" } };
    };
    renderApp("/home");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Logout" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument());
    const logout = calls.find((c) => c.key === "POST /v1/auth/logout")!;
    expect(logout.init?.credentials).toBe("include");
  });

  it("stays on home and shows an error if logout fails", async () => {
    routes[ME] = () => ({ status: 200, json: me });
    routes["POST /v1/auth/logout"] = () => "network-error";
    renderApp("/home");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Logout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't log out");
    expect(screen.getByText("merchant@example.com")).toBeInTheDocument();
  });

  it("a refresh after logout shows the login page (server now answers 401)", async () => {
    let loggedIn = true;
    routes[ME] = () => (loggedIn ? { status: 200, json: me } : unauth());
    routes["POST /v1/auth/logout"] = () => {
      loggedIn = false;
      return { status: 200, json: { message: "Logged out successfully" } };
    };
    const first = renderApp("/home");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Logout" }));
    await screen.findByRole("heading", { name: "Welcome" });
    first.history.destroy();
    document.body.innerHTML = "";
    renderApp("/home");
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
  });
});
