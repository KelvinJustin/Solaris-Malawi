import { useEffect, useRef, useState, type ComponentType, type ReactNode, type SVGProps } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import logo from "@/assets/logo.png";
import { CloseIcon, HomeIcon, MenuIcon, PaymentsIcon, StoreIcon } from "@/components/icons";
import { Skeleton } from "@/components/states";
import { StatusPill } from "@/components/StatusPill";
import { useAuth } from "@/lib/auth";
import { useProfile } from "@/lib/merchant-profile";
import { cn } from "@/lib/utils";

const NAV: { to: "/home" | "/payments" | "/profile"; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { to: "/home", label: "Home", icon: HomeIcon },
  { to: "/payments", label: "Payments", icon: PaymentsIcon },
  { to: "/profile", label: "Business profile", icon: StoreIcon },
];

/**
 * Layout for everything a signed-in merchant sees: a sidebar on large screens that becomes a
 * slide-over menu on phones, with the account status and logout always within reach.
 * Pages render inside <main>.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const { merchant, logout } = useAuth();
  const profile = useProfile();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  // Picking a destination closes the phone menu.
  useEffect(() => setMenuOpen(false), [pathname]);

  // While the phone menu is open: focus moves into it, and Escape closes it and gives focus back.
  useEffect(() => {
    if (!menuOpen) return;
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      openButton.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  async function onLogout() {
    setLogoutError(null);
    setLoggingOut(true);
    try {
      // On success the session is cleared and the auth gate redirects to the login page.
      await logout();
    } catch {
      setLogoutError("Couldn't log out. Please try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to content
      </a>

      {/* Phone top bar. The sidebar below is the same element on every screen size. */}
      <div className="sticky top-0 z-20 col-start-2 flex h-16 items-center justify-between border-b bg-background/90 px-5 backdrop-blur lg:hidden">
        <Link to="/home" aria-label="SmartPay home">
          <img src={logo} alt="" className="h-8 w-auto" />
        </Link>
        <button
          ref={openButton}
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Open menu"
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          className="flex size-11 items-center justify-center rounded-full hover:bg-muted"
        >
          <MenuIcon />
        </button>
      </div>

      {menuOpen ? (
        <div aria-hidden="true" className="fixed inset-0 z-30 bg-foreground/30 lg:hidden" onClick={() => setMenuOpen(false)} />
      ) : null}

      <aside
        id="app-sidebar"
        aria-label="Sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-72 max-w-[85vw] flex-col gap-6 overflow-y-auto border-r bg-card px-4 py-5 shadow-soft",
          "transition-[transform,visibility] duration-200 motion-reduce:transition-none",
          "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-auto lg:max-w-none lg:translate-x-0 lg:visible lg:shadow-none",
          menuOpen ? "translate-x-0 visible" : "-translate-x-full invisible",
        )}
      >
        <div className="flex items-center justify-between px-2">
          <Link to="/home" aria-label="SmartPay home">
            <img src={logo} alt="" className="h-12 w-auto" />
          </Link>
          <button
            ref={closeButton}
            type="button"
            onClick={() => {
              setMenuOpen(false);
              openButton.current?.focus();
            }}
            aria-label="Close menu"
            className="flex size-10 items-center justify-center rounded-full hover:bg-muted lg:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <nav aria-label="Main">
          <ul className="space-y-1">
            {NAV.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link
                  to={to}
                  activeProps={{ "aria-current": "page" }}
                  className={cn(
                    "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-muted-foreground transition-colors",
                    "hover:bg-muted hover:text-foreground",
                    "data-[status=active]:bg-primary data-[status=active]:text-primary-foreground",
                    "data-[status=active]:hover:bg-primary data-[status=active]:hover:text-primary-foreground",
                  )}
                >
                  <Icon />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto space-y-4 border-t pt-4">
          <div className="px-2">
            <p className="text-xs font-medium text-muted-foreground">Account status</p>
            <div className="mt-1.5">
              {profile.status === "loading" ? (
                <Skeleton className="h-7 w-28 rounded-full" />
              ) : profile.status === "success" ? (
                <StatusPill status={profile.data.accountStatus} />
              ) : (
                <p className="text-sm text-muted-foreground">Unavailable right now</p>
              )}
            </div>
          </div>

          <div className="px-2">
            <p className="text-xs font-medium text-muted-foreground">Signed in as</p>
            <p className="mt-1 truncate text-sm font-semibold" title={merchant?.email}>
              {merchant?.email}
            </p>
          </div>

          {logoutError ? (
            <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm font-medium text-destructive">
              {logoutError}
            </p>
          ) : null}

          <button type="button" onClick={onLogout} disabled={loggingOut} className="btn-secondary w-full disabled:opacity-60">
            {loggingOut ? "Logging out…" : "Logout"}
          </button>
        </div>
      </aside>

      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-4xl px-5 py-8 outline-none sm:px-8 lg:col-start-2 lg:row-start-1 lg:px-12 lg:py-12">
        {children}
      </main>
    </div>
  );
}
