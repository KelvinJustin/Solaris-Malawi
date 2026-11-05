import { Link, createFileRoute } from "@tanstack/react-router";
import { StoreIcon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states";

export const Route = createFileRoute("/_authed/profile")({
  head: () => ({ meta: [{ title: "Business profile — SmartPay Malawi" }] }),
  component: BusinessProfile,
});

// Placeholder: the shell reserves the place for the profile form and document uploads.
function BusinessProfile() {
  return (
    <>
      <PageHeader title="Business profile" description="Your business details and verification documents." />
      <EmptyState
        icon={<StoreIcon />}
        title="Editing your profile isn't in the app yet"
        description="This is where you'll add your business details and documents, then submit them for review."
        action={
          <Link to="/home" className="btn-secondary">
            Back to home
          </Link>
        }
      />
    </>
  );
}
