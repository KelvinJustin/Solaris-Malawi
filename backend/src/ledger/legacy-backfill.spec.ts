import { describe, expect, it } from 'vitest';
import {
  LedgerAccountStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../generated/prisma/enums.js';
import { assessLegacyPayment, nonzeroLegacyMerchantLedgers } from './legacy-backfill.js';

const eligiblePayment = {
  id: 'payment-1',
  publicReference: 'sp_payment_1',
  status: PaymentStatus.SUCCEEDED,
  merchantId: 'merchant-1',
  merchant: { id: 'merchant-1' },
  provider: PaymentProvider.AIRTEL_MONEY,
  providerReference: 'provider-ref-1',
  processedAt: new Date('2026-01-01T00:00:00Z'),
  amountTambala: 10_000,
  currency: 'MWK',
  attempts: [{
    status: PaymentAttemptStatus.SUCCEEDED,
    provider: PaymentProvider.AIRTEL_MONEY,
    providerReference: 'provider-ref-1',
    completedAt: new Date('2026-01-01T00:00:00Z'),
  }],
};

const validProviderAccount = {
  status: LedgerAccountStatus.ACTIVE,
  code: 'PROVIDER_CLEARING',
  currency: 'MWK',
  provider: PaymentProvider.AIRTEL_MONEY,
  merchantId: null,
};

describe('legacy ledger backfill eligibility', () => {
  it('accepts a successful payment with matching provider-confirmation evidence', () => {
    expect(assessLegacyPayment(eligiblePayment, validProviderAccount)).toBeNull();
  });

  it('excludes a SUCCEEDED payment with missing verification evidence', () => {
    expect(assessLegacyPayment({
      ...eligiblePayment,
      processedAt: null,
    }, validProviderAccount)).toBe('MISSING_VERIFIED_PAYMENT_EVIDENCE');

    expect(assessLegacyPayment({
      ...eligiblePayment,
      attempts: [],
    }, validProviderAccount)).toBe('MISSING_MATCHING_SUCCESSFUL_ATTEMPT');
  });

  it('excludes missing merchant and provider account mappings', () => {
    expect(assessLegacyPayment({
      ...eligiblePayment,
      merchant: null,
    }, validProviderAccount)).toBe('MISSING_MERCHANT');
    expect(assessLegacyPayment(eligiblePayment, null)).toBe('MISSING_OR_INVALID_PROVIDER_ACCOUNT_MAPPING');
  });

  it('reports only nonzero legacy merchant balances without assigning them accounting meaning', () => {
    const records = [
      { merchantId: 'merchant-1', availableBalance: 0, pendingBalance: 0 },
      { merchantId: 'merchant-2', availableBalance: 2_000, pendingBalance: 0 },
      { merchantId: 'merchant-3', availableBalance: 0, pendingBalance: -100 },
    ];

    expect(nonzeroLegacyMerchantLedgers(records)).toEqual(records.slice(1));
  });
});
