import { describe, expect, it, vi } from 'vitest';
import {
  LedgerAccountStatus,
  LedgerEntryDirection,
  PaymentProvider,
} from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';
import { CryptoLedgerPostingService } from './crypto-ledger-posting.service.js';

describe('CryptoLedgerPostingService', () => {
  function createTransactionClient() {
    const tx = {
      cryptoLedgerTransaction: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'crypto-ledger-transaction' }),
        update: vi.fn().mockResolvedValue({ id: 'crypto-ledger-transaction' }),
      },
      cryptoLedgerAccount: {
        upsert: vi.fn().mockImplementation(async (args) => ({
          id: args.where.key,
          ...args.create,
          status: LedgerAccountStatus.ACTIVE,
        })),
      },
      cryptoLedgerEntry: {
        createMany: vi.fn().mockResolvedValue({ count: 3 }),
      },
      cryptoLedgerAccountBalance: {
        upsert: vi.fn().mockResolvedValue({}),
      },
    };

    return tx;
  }

  it('deducts the configured basis-point fee and posts a balanced amount', async () => {
    const tx = createTransactionClient();
    const service = new CryptoLedgerPostingService();

    const posting = await service.postSuccessfulCryptoPayment(
      tx as unknown as Prisma.TransactionClient,
      {
        paymentId: 'payment-1',
        publicReference: 'public-1',
        merchantId: 'merchant-1',
        provider: PaymentProvider.NOWPAYMENTS,
        asset: 'BTC',
        network: null,
        actuallyPaidAmount: '0.00012',
        feeBps: 250,
      },
    );

    const entries = tx.cryptoLedgerEntry.createMany.mock.calls[0][0]
      .data as Array<{
      direction: LedgerEntryDirection;
      amount: { toString(): string };
    }>;
    expect(entries).toHaveLength(3);
    expect(posting.feeAmount.toString()).toBe('0.000003');
    expect(posting.merchantNetAmount.toString()).toBe('0.000117');
    expect(
      entries.map((entry) => [entry.direction, entry.amount.toString()]),
    ).toEqual([
      [LedgerEntryDirection.DEBIT, '0.00012'],
      [LedgerEntryDirection.CREDIT, '0.000117'],
      [LedgerEntryDirection.CREDIT, '0.000003'],
    ]);
  });

  it('keeps the full amount as merchant net when the configured fee is zero', async () => {
    const tx = createTransactionClient();
    const service = new CryptoLedgerPostingService();

    await service.postSuccessfulCryptoPayment(
      tx as unknown as Prisma.TransactionClient,
      {
        paymentId: 'payment-2',
        publicReference: 'public-2',
        merchantId: 'merchant-1',
        provider: PaymentProvider.NOWPAYMENTS,
        asset: 'BTC',
        network: null,
        actuallyPaidAmount: '0.00012',
        feeBps: 0,
      },
    );

    const entries = tx.cryptoLedgerEntry.createMany.mock.calls[0][0]
      .data as Array<{
      direction: LedgerEntryDirection;
      amount: { toString(): string };
    }>;
    expect(entries).toHaveLength(2);
    expect(
      entries.map((entry) => [entry.direction, entry.amount.toString()]),
    ).toEqual([
      [LedgerEntryDirection.DEBIT, '0.00012'],
      [LedgerEntryDirection.CREDIT, '0.00012'],
    ]);
  });
});
