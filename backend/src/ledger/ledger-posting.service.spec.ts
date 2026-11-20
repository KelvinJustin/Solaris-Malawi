import { describe, expect, it, vi } from 'vitest';
import {
  LedgerAccountStatus,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  PaymentProvider,
} from '../generated/prisma/enums.js';
import { LedgerPostingService } from './ledger-posting.service.js';

function makeTransactionClient() {
  const createdEntries: Array<Record<string, unknown>> = [];
  const createdAccounts = new Map<string, Record<string, unknown>>();
  let transactionId = 'ledger-transaction-1';
  const tx = {
    ledgerTransaction: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }) => {
        expect(data.status).toBe(LedgerTransactionStatus.PENDING);
        return { id: transactionId, ...data };
      }),
      update: vi.fn().mockImplementation(async ({ data, include }) => ({
        id: transactionId,
        ...data,
        entries: include?.entries ? createdEntries : undefined,
      })),
    },
    ledgerAccount: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'provider-account',
        key: 'provider-clearing:MWK:AIRTEL_MONEY',
        code: 'PROVIDER_CLEARING',
        name: 'Airtel clearing',
        type: 'ASSET',
        normalBalance: 'DEBIT',
        status: LedgerAccountStatus.ACTIVE,
        currency: 'MWK',
        merchantId: null,
        provider: PaymentProvider.AIRTEL_MONEY,
      }),
      upsert: vi.fn().mockImplementation(async ({ where, create }) => {
        const existing = createdAccounts.get(where.key);
        if (existing) return existing;
        const account = {
          id: `account-${createdAccounts.size + 1}`,
          ...create,
          status: LedgerAccountStatus.ACTIVE,
        };
        createdAccounts.set(where.key, account);
        return account;
      }),
    },
    ledgerEntry: {
      createMany: vi.fn().mockImplementation(async ({ data }) => {
        createdEntries.push(...data);
        return { count: data.length };
      }),
    },
    ledgerAccountBalance: {
      upsert: vi.fn().mockResolvedValue({}),
    },
  };
  return { tx: tx as any, createdEntries, createdAccounts };
}

const payment = {
  paymentId: 'payment-uuid',
  publicReference: 'sp_payment',
  merchantId: 'merchant-uuid',
  provider: PaymentProvider.AIRTEL_MONEY,
  amountTambala: 10_000n,
  feeTambala: 200n,
  merchantNetTambala: 9_800n,
  currency: 'MWK',
  source: 'CALLBACK' as const,
};

describe('LedgerPostingService', () => {
  it('creates one balanced payment transaction and updates projections using the provided tx', async () => {
    const { tx, createdEntries } = makeTransactionClient();
    const service = new LedgerPostingService();

    await service.postSuccessfulPayment(tx, payment);

    expect(tx.ledgerTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.ledgerEntry.createMany).toHaveBeenCalledTimes(1);
    const debits = createdEntries
      .filter((entry) => entry.direction === LedgerEntryDirection.DEBIT)
      .reduce((sum, entry) => sum + (entry.amountTambala as bigint), 0n);
    const credits = createdEntries
      .filter((entry) => entry.direction === LedgerEntryDirection.CREDIT)
      .reduce((sum, entry) => sum + (entry.amountTambala as bigint), 0n);
    expect(debits).toBe(10_000n);
    expect(credits).toBe(10_000n);
    expect(createdEntries).toHaveLength(3);
    expect(tx.ledgerAccountBalance.upsert).toHaveBeenCalledTimes(3);
    expect(tx.ledgerTransaction.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: LedgerTransactionStatus.POSTED }),
    }));
  });

  it('omits the revenue entry for zero-fee payments', async () => {
    const { tx, createdEntries } = makeTransactionClient();
    const service = new LedgerPostingService();

    await service.postSuccessfulPayment(tx, {
      ...payment,
      feeTambala: 0n,
      merchantNetTambala: payment.amountTambala,
    });

    expect(createdEntries).toHaveLength(2);
    expect(createdEntries.map((entry) => entry.amountTambala)).toEqual([10_000n, 10_000n]);
  });

  it('returns an existing posted transaction without duplicating entries', async () => {
    const { tx } = makeTransactionClient();
    tx.ledgerTransaction.findUnique.mockResolvedValue({
      id: 'existing',
      status: LedgerTransactionStatus.POSTED,
      entries: [],
    });

    const result = await new LedgerPostingService().postSuccessfulPayment(tx, payment);

    expect(result.id).toBe('existing');
    expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
    expect(tx.ledgerEntry.createMany).not.toHaveBeenCalled();
  });

  it('rejects inconsistent fee snapshots before writing ledger records', async () => {
    const { tx } = makeTransactionClient();

    await expect(new LedgerPostingService().postSuccessfulPayment(tx, {
      ...payment,
      merchantNetTambala: 9_700n,
    })).rejects.toThrow('Payment fee snapshot is invalid');

    expect(tx.ledgerTransaction.create).not.toHaveBeenCalled();
  });
});
