import {
  LedgerAccountStatus,
  PaymentAttemptStatus,
  PaymentStatus,
} from '../generated/prisma/enums.js';

interface LegacyAttemptEvidence {
  status: PaymentAttemptStatus;
  provider: string;
  providerReference: string | null;
  completedAt: Date | null;
}

export interface LegacyPaymentCandidate {
  id: string;
  publicReference: string;
  status: PaymentStatus;
  merchantId: string;
  merchant: { id: string } | null;
  provider: string | null;
  providerReference: string | null;
  processedAt: Date | null;
  amountTambala: number;
  currency: string;
  attempts: LegacyAttemptEvidence[];
}

interface ProviderAccountEvidence {
  status: LedgerAccountStatus;
  code: string;
  currency: string;
  provider: string | null;
  merchantId: string | null;
}

export type LegacyPaymentExclusionReason =
  | 'NOT_SUCCEEDED'
  | 'MISSING_MERCHANT'
  | 'MISSING_PROVIDER'
  | 'MISSING_VERIFIED_PAYMENT_EVIDENCE'
  | 'INVALID_AMOUNT'
  | 'MISSING_MATCHING_SUCCESSFUL_ATTEMPT'
  | 'MISSING_OR_INVALID_PROVIDER_ACCOUNT_MAPPING';

export function assessLegacyPayment(
  payment: LegacyPaymentCandidate,
  providerAccount: ProviderAccountEvidence | null,
): LegacyPaymentExclusionReason | null {
  if (payment.status !== PaymentStatus.SUCCEEDED) return 'NOT_SUCCEEDED';
  if (!payment.merchant) return 'MISSING_MERCHANT';
  if (!payment.provider) return 'MISSING_PROVIDER';
  if (!payment.providerReference || !payment.processedAt) {
    return 'MISSING_VERIFIED_PAYMENT_EVIDENCE';
  }
  if (payment.amountTambala <= 0) return 'INVALID_AMOUNT';
  const hasMatchingSuccess = payment.attempts.some((attempt) =>
    attempt.status === PaymentAttemptStatus.SUCCEEDED &&
    attempt.provider === payment.provider &&
    Boolean(attempt.providerReference) &&
    attempt.providerReference === payment.providerReference &&
    attempt.completedAt !== null,
  );
  if (!hasMatchingSuccess) return 'MISSING_MATCHING_SUCCESSFUL_ATTEMPT';
  if (
    !providerAccount ||
    providerAccount.status !== LedgerAccountStatus.ACTIVE ||
    providerAccount.code !== 'PROVIDER_CLEARING' ||
    providerAccount.currency !== payment.currency ||
    providerAccount.provider !== payment.provider ||
    providerAccount.merchantId !== null
  ) return 'MISSING_OR_INVALID_PROVIDER_ACCOUNT_MAPPING';
  return null;
}

export function nonzeroLegacyMerchantLedgers<T extends {
  availableBalance: number;
  pendingBalance: number;
}>(records: T[]): T[] {
  return records.filter((record) => record.availableBalance !== 0 || record.pendingBalance !== 0);
}
