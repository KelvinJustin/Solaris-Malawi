import { Link, createFileRoute } from "@tanstack/react-router";
import { CheckCircleIcon, CircleIcon, StoreIcon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState, LoadingState, ResourceBoundary } from "@/components/states";
import { StatusPill } from "@/components/StatusPill";
import { useProfile } from "@/lib/merchant-profile";
import { formatDate } from "@/lib/format";
import {
  BUSINESS_TYPE_LABEL,
  applicationSteps,
  hasBusinessDetails,
  isEditable,
  statusMeta,
  type MerchantProfile,
} from "@/lib/profile";

export const Route = createFileRoute("/_authed/home")({
  head: () => ({ meta: [{ title: "Home — SmartPay Malawi" }] }),
  component: Home,
});

function Home() {
  const profile = useProfile();
  return (
    <>
      <PageHeader title="Welcome back" description="Here's where your account stands." />
      <ResourceBoundary
        resource={profile}
        loading={<LoadingState label="Loading your account…" cards={2} />}
        errorTitle="We couldn't load your account"
      >
        {(p) => (
          <div className="space-y-6">
            <AccountStatusCard profile={p} />
            <BusinessDetailsCard profile={p} />
          </div>
        )}
      </ResourceBoundary>
    </>
  );
}

function AccountStatusCard({ profile }: { profile: MerchantProfile }) {
  const meta = statusMeta(profile.accountStatus);
  const status = profile.accountStatus;
  const showSteps = isEditable(status);
  const submitted = formatDate(profile.submittedAt);
  const approved = formatDate(profile.approvedAt);

  return (
    <section aria-labelledby="account-status-heading" className="rounded-3xl bg-card p-6 shadow-soft sm:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="account-status-heading" className="text-lg font-bold tracking-tight">
          Account status
        </h2>
        <StatusPill status={status} />
      </div>

      <p className="mt-3 max-w-prose text-muted-foreground">{meta.summary}</p>

      {status === "REJECTED" && profile.rejectionReason ? (
        <div className="mt-5 rounded-2xl bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">Note from the reviewer</p>
          <p className="mt-1 whitespace-pre-line break-words">{profile.rejectionReason}</p>
        </div>
      ) : null}

      {showSteps ? (
        <ul className="mt-6 space-y-3">
          {applicationSteps(profile).map((step) => (
            <li key={step.label} className="flex items-center gap-3 text-sm font-medium">
              {step.done ? (
                <CheckCircleIcon className="shrink-0 text-success" />
              ) : (
                <CircleIcon className="shrink-0 text-muted-foreground" />
              )}
              <span className={step.done ? undefined : "text-muted-foreground"}>
                {step.label}
                <span className="sr-only">{step.done ? " (done)" : " (still to do)"}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {!showSteps && submitted ? (
        <p className="mt-5 text-sm text-muted-foreground">Submitted on {submitted}</p>
      ) : null}
      {status === "APPROVED" && approved ? <p className="mt-1 text-sm text-muted-foreground">Approved on {approved}</p> : null}

      {meta.action ? (
        <Link to="/profile" className="btn-solid mt-6">
          {meta.action}
        </Link>
      ) : null}
    </section>
  );
}

function BusinessDetailsCard({ profile }: { profile: MerchantProfile }) {
  if (!hasBusinessDetails(profile)) {
    return (
      <EmptyState
        icon={<StoreIcon />}
        title="No business details yet"
        description="Your business name, type and contact details will appear here once you've added them."
        action={
          isEditable(profile.accountStatus) ? (
            <Link to="/profile" className="btn-secondary">
              Go to business profile
            </Link>
          ) : undefined
        }
      />
    );
  }

  const location = [profile.city, profile.district].filter(Boolean).join(", ");
  const rows: [string, string | null][] = [
    ["Business name", profile.businessName],
    ["Trading name", profile.tradingName],
    ["Business type", profile.businessType ? BUSINESS_TYPE_LABEL[profile.businessType] : null],
    ["Location", location || null],
    ["Support email", profile.supportEmail],
    ["Support phone", profile.supportPhone],
  ];

  return (
    <section aria-labelledby="business-details-heading" className="rounded-3xl bg-card p-6 shadow-soft sm:p-8">
      <h2 id="business-details-heading" className="text-lg font-bold tracking-tight">
        Business details
      </h2>
      <dl className="mt-5 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className={value ? "mt-0.5 break-words font-semibold" : "mt-0.5 text-muted-foreground"}>{value ?? "Not added"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
