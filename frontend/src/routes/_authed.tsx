import { Navigate, Outlet, createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/lib/auth";
import { ProfileProvider } from "@/lib/merchant-profile";

// Pages that need a session. Anyone else is sent to the login page ("/").
// Everything inside shares the app shell (navigation, account status, logout).
export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  const { status } = useAuth();
  if (status !== "authenticated") return <Navigate to="/" replace />;
  return (
    <ProfileProvider>
      <AppShell>
        <Outlet />
      </AppShell>
    </ProfileProvider>
  );
}
