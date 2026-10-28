import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { statusMeta } from "@/lib/profile";
import { ME, PROFILE, calls, installFakeApi, me, profileFixture, renderApp, routes, unauth } from "./harness";

installFakeApi();

function signedIn(profile = profileFixture()) {
  routes[ME] = () => ({ status: 200, json: me });
  routes[PROFILE] = () => ({ status: 200, json: profile });
}

const sidebar = () => screen.getByRole("complementary", { name: "Sidebar" });

describe("navigation and layout", () => {
  it("shows the sidebar with the three destinations, the merchant's email and Logout", async () => {
    signedIn();
    renderApp("/home");
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/payments");
    expect(within(nav).getByRole("link", { name: "Business profile" })).toHaveAttribute("href", "/profile");
    expect(within(sidebar()).getByText("merchant@example.com")).toBeInTheDocument();
    expect(within(sidebar()).getByRole("button", { name: "Logout" })).toBeInTheDocument();
  });

  it("offers a skip link to the main content", async () => {
    signedIn();
    renderApp("/home");
    expect(await screen.findByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("moves between pages without fetching the profile again", async () => {
    signedIn();
    renderApp("/home");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Payments" }));
    expect(await screen.findByRole("heading", { name: "Payments", level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Payments will show up here")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("link", { name: "Business profile" }));
    expect(await screen.findByRole("heading", { name: "Business profile", level: 1 })).toBeInTheDocument();
    expect(calls.filter((c) => c.key === PROFILE)).toHaveLength(1);
  });

  it("opens and closes the phone menu, and Escape closes it", async () => {
    signedIn();
    renderApp("/home");
    const user = userEvent.setup();
    const open = await screen.findByRole("button", { name: "Open menu" });
    expect(open).toHaveAttribute("aria-expanded", "false");
    await user.click(open);
    expect(open).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Close menu" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(open).toHaveAttribute("aria-expanded", "false");
    expect(open).toHaveFocus();
  });

  it("closes the phone menu after choosing a destination", async () => {
    signedIn();
    renderApp("/home");
    const user = userEvent.setup();
    const open = await screen.findByRole("button", { name: "Open menu" });
    await user.click(open);
    await user.click(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Payments" }));
    expect(await screen.findByRole("heading", { name: "Payments", level: 1 })).toBeInTheDocument();
    expect(open).toHaveAttribute("aria-expanded", "false");
  });
});

describe("account status", () => {
  it("shows a loading state first, then the status in the page and the sidebar", async () => {
    signedIn();
    renderApp("/home");
    expect(await screen.findByText("Loading your account…")).toBeInTheDocument();
    const card = await screen.findByRole("region", { name: "Account status" });
    expect(within(card).getByText("Not submitted")).toBeInTheDocument();
    expect(within(sidebar()).getByText("Not submitted")).toBeInTheDocument();
  });

  it("a merchant who hasn't submitted sees what's left to do and a way forward", async () => {
    signedIn(
      profileFixture({
        businessName: "Example Traders",
        businessType: "SOLE_TRADER",
        documents: [{ id: "d1", type: "NATIONAL_ID_FRONT", status: "PENDING", supersededAt: null }],
      }),
    );
    renderApp("/home");
    const card = await screen.findByRole("region", { name: "Account status" });
    expect(within(card).getByText(/Business details added/)).toHaveTextContent("(done)");
    expect(within(card).getByText(/Documents uploaded/)).toHaveTextContent("(done)");
    expect(within(card).getByText(/Submitted for review/)).toHaveTextContent("(still to do)");
    expect(within(card).getByRole("link", { name: "Complete your profile" })).toHaveAttribute("href", "/profile");
  });

  it("ignores superseded documents when counting uploads", async () => {
    signedIn(
      profileFixture({
        documents: [{ id: "d1", type: "NATIONAL_ID_FRONT", status: "REJECTED", supersededAt: "2026-10-01T00:00:00Z" }],
      }),
    );
    renderApp("/home");
    const card = await screen.findByRole("region", { name: "Account status" });
    expect(within(card).getByText(/Documents uploaded/)).toHaveTextContent("(still to do)");
  });

  it("shows the reviewer's note when the application needs changes", async () => {
    signedIn(profileFixture({ accountStatus: "REJECTED", rejectionReason: "The ID photo is blurry." }));
    renderApp("/home");
    const card = await screen.findByRole("region", { name: "Account status" });
    expect(within(card).getByText("Needs changes")).toBeInTheDocument();
    expect(within(card).getByText("The ID photo is blurry.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Review and resubmit" })).toBeInTheDocument();
  });

  it("an in-review application has nothing for the merchant to do", async () => {
    signedIn(profileFixture({ accountStatus: "UNDER_REVIEW", submittedAt: "2026-10-12T09:00:00Z" }));
    renderApp("/home");
    const card = await screen.findByRole("region", { name: "Account status" });
    expect(within(card).getByText("Under review")).toBeInTheDocument();
    expect(within(card).getByText("Submitted on 12 Oct 2026")).toBeInTheDocument();
    expect(within(card).queryByRole("link")).not.toBeInTheDocument();
    expect(within(card).queryByText(/Business details added/)).not.toBeInTheDocument();
  });

  it("an approved merchant is told they can accept payments", async () => {
    signedIn(profileFixture({ accountStatus: "APPROVED", submittedAt: "2026-10-12T09:00:00Z", approvedAt: "2026-10-14T09:00:00Z" }));
    renderApp("/home");
    const card = await screen.findByRole("region", { name: "Account status" });
    expect(within(card).getByText("Approved")).toBeInTheDocument();
    expect(within(card).getByText("Your account is approved. You can accept payments.")).toBeInTheDocument();
    expect(within(card).getByText("Approved on 14 Oct 2026")).toBeInTheDocument();
  });

  it("copes with a status the app doesn't know yet", () => {
    expect(statusMeta("ARCHIVED")).toMatchObject({ label: "Archived", tone: "neutral" });
  });
});

describe("business details", () => {
  it("shows an empty state, with a link, before any details exist", async () => {
    signedIn();
    renderApp("/home");
    expect(await screen.findByText("No business details yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to business profile" })).toHaveAttribute("href", "/profile");
  });

  it("lists what has been added and marks the rest", async () => {
    signedIn(profileFixture({ businessName: "Example Traders", businessType: "LIMITED_COMPANY", city: "Blantyre", district: "Blantyre" }));
    renderApp("/home");
    const card = await screen.findByRole("region", { name: "Business details" });
    expect(within(card).getByText("Example Traders")).toBeInTheDocument();
    expect(within(card).getByText("Limited company")).toBeInTheDocument();
    expect(within(card).getByText("Blantyre, Blantyre")).toBeInTheDocument();
    expect(within(card).getAllByText("Not added")).toHaveLength(3); // trading name, support email, support phone
  });
});

describe("load failures", () => {
  it("explains a server error and recovers on retry", async () => {
    signedIn();
    let attempt = 0;
    routes[PROFILE] = () =>
      ++attempt === 1 ? { status: 500, json: { message: "Internal server error" } } : { status: 200, json: profileFixture({ accountStatus: "APPROVED" }) };
    renderApp("/home");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't load your account");
    expect(alert).toHaveTextContent("Something went wrong on our side");
    expect(within(sidebar()).getByText("Unavailable right now")).toBeInTheDocument();

    await userEvent.setup().click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Account status" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.key === PROFILE)).toHaveLength(2);
  });

  it("says so when the server can't be reached", async () => {
    signedIn();
    routes[PROFILE] = () => "network-error";
    renderApp("/home");
    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server");
  });

  it("sends the merchant to the login page if the session ended mid-use (401)", async () => {
    signedIn();
    routes[PROFILE] = () => unauth();
    renderApp("/home");
    expect(await screen.findByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  });
});
