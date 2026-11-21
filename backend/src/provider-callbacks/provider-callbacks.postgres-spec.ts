import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  LedgerAccountStatus,
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
  LedgerTransactionStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
  PaymentType,
} from '../generated/prisma/enums.js';
import { Prisma } from '../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import { CryptoLedgerPostingService } from '../ledger/crypto-ledger-posting.service.js';
import { LedgerPostingService } from '../ledger/ledger-posting.service.js';
import type { NowPaymentsIpnPayload } from '../payment-providers/adapters/nowpayments/nowpayments-webhook-payload.guard.js';
import { ProviderCallbacksService } from './provider-callbacks.service.js';

describe('NOWPayments PostgreSQL integration', () => {
  let database: DatabaseService;
  let callbacks: ProviderCallbacksService;
  let originalDatabaseUrl: string | undefined;

  const providerClearingKey =
    'crypto-provider-clearing:NOWPAYMENTS:BTC:NONE';

  beforeAll(async () => {
    const testDatabaseUrl = process.env.LEDGER_TEST_DATABASE_URL;
    if (!testDatabaseUrl) {
      throw new Error('LEDGER_TEST_DATABASE_URL is required');
    }
    const databaseName = decodeURIComponent(
      new URL(testDatabaseUrl).pathname.slice(1),
    );
    if (!/(^|[_-])test([_-]|$)/i.test(databaseName)) {
      throw new Error(
        'LEDGER_TEST_DATABASE_URL must point to a dedicated test database',
      );
    }

    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testDatabaseUrl;
    database = new DatabaseService();
    await database.$connect();

    callbacks = new ProviderCallbacksService(
      database,
      new LedgerPostingService(),
      new CryptoLedgerPostingService(),
      { getOrThrow: () => 250 } as unknown as ConfigService,
    );
  });

  afterAll(async () => {
    await database?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('posts one balanced crypto capture for concurrent duplicate finished IPNs', async () => {
    const fixture = await createCryptoPaymentFixture();
    const payload: NowPaymentsIpnPayload = {
      payment_id: fixture.nowPaymentsId,
      payment_status: 'finished',
      actually_paid: '0.00012',
    };

    const results = await Promise.all([
      callbacks.handleNowPaymentsCallback(payload),
      callbacks.handleNowPaymentsCallback(payload),
    ]);

    const [payment, attempt, postings, eventCount] = await Promise.all([
      database.paymentTransaction.findUniqueOrThrow({
        where: { id: fixture.paymentId },
      }),
      database.paymentAttempt.findUniqueOrThrow({
        where: { id: fixture.attemptId },
      }),
      database.cryptoLedgerTransaction.findMany({
        where: {
          sourceType: 'CRYPTO_PAYMENT',
          sourceId: fixture.paymentId,
          postingPurpose: 'SUCCESS',
        },
        include: { entries: { include: { account: true } } },
      }),
      database.cryptoPaymentIpnEvent.count({
        where: {
          cryptoPaymentDetail: {
            nowpaymentsPaymentId: fixture.nowPaymentsId,
          },
        },
      }),
    ]);

    expect(
      results
        .map((result) => result.duplicate)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
    expect(payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(attempt.status).toBe(PaymentAttemptStatus.SUCCEEDED);
    expect(postings).toHaveLength(1);
    expect(eventCount).toBe(2);
    expect(postings[0].status).toBe(LedgerTransactionStatus.POSTED);
    expect(postings[0].entries).toHaveLength(3);

    const debitTotal = postings[0].entries
      .filter((entry) => entry.direction === LedgerEntryDirection.DEBIT)
      .reduce(
        (total, entry) => total.add(entry.amount),
        new Prisma.Decimal(0),
      );
    const creditTotal = postings[0].entries
      .filter((entry) => entry.direction === LedgerEntryDirection.CREDIT)
      .reduce(
        (total, entry) => total.add(entry.amount),
        new Prisma.Decimal(0),
      );
    const fee = postings[0].entries.find(
      (entry) => entry.account.code === 'PLATFORM_CRYPTO_FEE_REVENUE',
    );

    expect(debitTotal.toString()).toBe('0.00012');
    expect(creditTotal.toString()).toBe('0.00012');
    expect(fee?.amount.toString()).toBe('0.000003');
  });

  it('rolls back payment and attempt updates when the crypto ledger account is frozen', async () => {
    const fixture = await createCryptoPaymentFixture();
    const clearingAccount = await database.cryptoLedgerAccount.upsert({
      where: { key: providerClearingKey },
      create: {
        key: providerClearingKey,
        code: 'PROVIDER_CRYPTO_CLEARING',
        name: 'NOWPayments BTC clearing',
        type: LedgerAccountType.ASSET,
        normalBalance: LedgerNormalBalance.DEBIT,
        status: LedgerAccountStatus.FROZEN,
        asset: 'BTC',
        network: null,
        provider: PaymentProvider.NOWPAYMENTS,
      },
      update: { status: LedgerAccountStatus.FROZEN },
    });

    try {
      await expect(
        callbacks.handleNowPaymentsCallback({
          payment_id: fixture.nowPaymentsId,
          payment_status: 'finished',
          actually_paid: '0.00012',
        }),
      ).rejects.toThrow('is not active');
    } finally {
      await database.cryptoLedgerAccount.update({
        where: { id: clearingAccount.id },
        data: { status: LedgerAccountStatus.ACTIVE },
      });
    }

    const [payment, attempt, postings, eventCount] = await Promise.all([
      database.paymentTransaction.findUniqueOrThrow({
        where: { id: fixture.paymentId },
      }),
      database.paymentAttempt.findUniqueOrThrow({
        where: { id: fixture.attemptId },
      }),
      database.cryptoLedgerTransaction.count({
        where: {
          sourceType: 'CRYPTO_PAYMENT',
          sourceId: fixture.paymentId,
          postingPurpose: 'SUCCESS',
        },
      }),
      database.cryptoPaymentIpnEvent.count({
        where: {
          cryptoPaymentDetail: {
            nowpaymentsPaymentId: fixture.nowPaymentsId,
          },
        },
      }),
    ]);

    expect(payment.status).toBe(PaymentStatus.PROCESSING);
    expect(attempt.status).toBe(PaymentAttemptStatus.PROCESSING);
    expect(postings).toBe(0);
    expect(eventCount).toBe(1);
  });

  async function createCryptoPaymentFixture() {
    const suffix = randomUUID();
    const merchant = await database.merchant.create({
      data: {
        name: `Crypto test ${suffix}`,
        email: `crypto-${suffix}@example.test`,
        passwordHash: 'integration-test',
        phone: `+265${suffix.replaceAll('-', '').slice(0, 9)}`,
      },
    });
    const payment = await database.paymentTransaction.create({
      data: {
        publicReference: `crypto-${suffix}`,
        merchantId: merchant.id,
        paymentType: PaymentType.CRYPTO,
        status: PaymentStatus.PROCESSING,
        provider: PaymentProvider.NOWPAYMENTS,
        providerReference: `np-${suffix}`,
        idempotencyKey: `crypto-${suffix}`,
        cryptoDetail: {
          create: {
            asset: 'BTC',
            network: null,
            requestedAmount: '0.00012',
            providerCurrency: 'btc',
            nowpaymentsPaymentId: `np-${suffix}`,
            payAmount: '0.00012',
            priceCurrency: 'btc',
            priceAmount: '0.00012',
            paymentAddress: `wallet-${suffix}`,
            lastReportedStatus: 'waiting',
          },
        },
      },
    });
    const attempt = await database.paymentAttempt.create({
      data: {
        transactionId: payment.id,
        attemptNumber: 1,
        provider: PaymentProvider.NOWPAYMENTS,
        status: PaymentAttemptStatus.PROCESSING,
        providerReference: `np-${suffix}`,
      },
    });
    await database.cryptoPaymentDetail.update({
      where: { transactionId: payment.id },
      data: { attemptId: attempt.id },
    });

    return {
      paymentId: payment.id,
      attemptId: attempt.id,
      nowPaymentsId: `np-${suffix}`,
    };
  }
});
