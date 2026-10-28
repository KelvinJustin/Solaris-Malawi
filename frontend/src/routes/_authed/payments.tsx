import { createFileRoute } from "@tanstack/react-router";
import { PaymentsIcon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/states";

export const Route = createFileRoute("/_authed/payments")({
  head: () => ({ meta: [{ title: "Payments — SmartPay Malawi" }] }),
  component: Payments,
});

// Placeholder: the shell reserves the place. Build the list on top of <ResourceBoundary> + useResource.
function Payments() {
  return (
    <>
      <PageHeader title="Payments" description="Money coming in from your customers." />
      <EmptyState
        icon={<PaymentsIcon />}
        title="Payments will show up here"
        description="Payment history isn't in the app yet. It's the next screen we're adding."
      />
    </>
  );
}
