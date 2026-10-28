// Shapes and wording for GET /merchants/profile. Only the fields the app reads are typed.

export type AccountStatus =
  | "PENDING_SUBMISSION"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUSPENDED";

export type BusinessType = "INDIVIDUAL" | "SOLE_TRADER" | "PARTNERSHIP" | "LIMITED_COMPANY" | "NGO";

export type ProfileDocument = {
  id: string;
  type: string;
  status: string;
  /** Set when a newer upload replaced this one; superseded documents don't count. */
  supersededAt: string | null;
};

export type MerchantProfile = {
  id: string;
  businessName: string | null;
  tradingName: string | null;
  businessType: BusinessType | null;
  supportEmail: string | null;
  supportPhone: string | null;
  city: string | null;
  district: string | null;
  accountStatus: AccountStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  documents: ProfileDocument[];
};

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

export type StatusMeta = {
  label: string;
  tone: StatusTone;
  /** One or two plain sentences telling the merchant where they stand. */
  summary: string;
  /** Label for the button that moves them forward; absent when there is nothing for them to do. */
  action?: string;
};

export const ACCOUNT_STATUS: Record<AccountStatus, StatusMeta> = {
  PENDING_SUBMISSION: {
    label: "Not submitted",
    tone: "warning",
    summary: "Add your business details and documents, then submit them for review. You can't accept payments until your account is approved.",
    action: "Complete your profile",
  },
  SUBMITTED: {
    label: "Submitted",
    tone: "info",
    summary: "We've received your application. A reviewer will pick it up soon. Your details are locked while it's in the queue.",
  },
  UNDER_REVIEW: {
    label: "Under review",
    tone: "info",
    summary: "A reviewer is checking your application right now. We'll update your status here as soon as there's a decision.",
  },
  APPROVED: {
    label: "Approved",
    tone: "success",
    summary: "Your account is approved. You can accept payments.",
  },
  REJECTED: {
    label: "Needs changes",
    tone: "danger",
    summary: "Your application wasn't approved as it stands. Fix what the reviewer flagged, then submit it again.",
    action: "Review and resubmit",
  },
  SUSPENDED: {
    label: "Suspended",
    tone: "danger",
    summary: "Your account is suspended and can't accept payments. Contact SmartPay support to find out why and what happens next.",
  },
};

const humanize = (v: string) => {
  const s = v.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Tolerates a status the frontend doesn't know yet (the backend may add enum values). */
export function statusMeta(status: string): StatusMeta {
  return (
    ACCOUNT_STATUS[status as AccountStatus] ?? {
      label: humanize(status),
      tone: "neutral",
      summary: "We'll show more here once this status is supported in the app.",
    }
  );
}

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  INDIVIDUAL: "Individual",
  SOLE_TRADER: "Sole trader",
  PARTNERSHIP: "Partnership",
  LIMITED_COMPANY: "Limited company",
  NGO: "NGO",
};

/** Statuses where the merchant can still change their application. */
export const isEditable = (s: AccountStatus) => s === "PENDING_SUBMISSION" || s === "REJECTED";

export type ApplicationStep = { label: string; done: boolean };

/** Progress through the application, derived only from what the API returns. */
export function applicationSteps(p: MerchantProfile): ApplicationStep[] {
  const submitted = !isEditable(p.accountStatus);
  return [
    { label: "Business details added", done: Boolean(p.businessName && p.businessType) },
    { label: "Documents uploaded", done: p.documents.some((d) => !d.supersededAt) },
    { label: "Submitted for review", done: submitted },
  ];
}

export function hasBusinessDetails(p: MerchantProfile): boolean {
  return Boolean(
    p.businessName || p.tradingName || p.businessType || p.supportEmail || p.supportPhone || p.city || p.district,
  );
}
