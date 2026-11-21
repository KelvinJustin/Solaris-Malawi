import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FeeType,
  LedgerAccountStatus,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../../../generated/prisma/enums.js';
import { DatabaseService } from '../../../database/database.service.js';
import { LedgerPostingService } from '../../../ledger/ledger-posting.service.js';
import { NowPaymentsWebhookService } from './nowpayments-webhook.service.js';

describe('NOWPayments PostgreSQL integration', () => {
  let database: DatabaseService;
  let webhookService: NowPaymentsWebhookService;
  let originalDatabaseUrl: string | undefined;
  let feePolicyId: string;
  const clearingAccountKey = 'provider-clearing:MWK:NOWPAYMENTS';

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

    const [policy, clearingAccount] = await Promise.all([
      database.feePolicy.findFirst({
        where: { merchantId: null, currency: 'MWK', active: true },
        select: { id: true, type: true },
      }),
      database.ledgerAccount.findUnique({
        where: { key: clearingAccountKey },
        select: { id: true, status: true },
      }),
    ]);
    if (!policy || policy.type !== FeeType.ZERO) {
      throw new Error('Active ZERO/MWK platform fee policy is required');
    }
    if (!clearingAccount || clearingAccount.status !== LedgerAccountStatus.ACTIVE) {
      throw new Error('Active NOWPAYMENTS MWK clearing account is required');
    }

    feePolicyId = policy.id;
    webhookService = new NowPaymentsWebhookService(
      database,
      new LedgerPostingService(),
    );
  });

  afterAll(async () => {
    await database?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('posts one balanced capture journal for concurrent duplicate finished IPNs', async () => {
    const fixture = await createCryptoPaymentFixture();
    const payload = {
      payment_id: fixture.nowPaymentsId,
      payment_status: 'finished' as const,
      actually_paid: 0.00012,
    };

    await Promise.all([
      webhookService.handleVerifiedCallback(payload),
      webhookService.handleVerifiedCallback(payload),
    ]);

    const [payment, attempt, ledgerTransactions, eventCount] = await Promise.all([
      database.paymentTransaction.findUniqueOrThrow({
        where: { id: fixture.paymentId },
      }),
      database.paymentAttempt.findUniqueOrThrow({
        where: { id: fixture.attemptId },
      }),
      database.ledgerTransaction.findMany({
        where: {
          sourceType: 'PAYMENT',
          sourceId: fixture.paymentId,
          postingPurpose: 'SUCCESS',
        },
        include: { entries: true },
      }),
      database.cryptoPaymentIpnEvent.count({
        where: {
          cryptoPaymentDetail: {
            nowpaymentsPaymentId: fixture.nowPaymentsId,
          },
        },
      }),
    ]);

    expect(payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(attempt.status).toBe(PaymentAttemptStatus.SUCCEEDED);
    expect(ledgerTransactions).toHaveLength(1);
    expect(eventCount).toBe(2);
    expect(ledgerTransactions[0].status).toBe(LedgerTransactionStatus.POSTED);
    expect(ledgerTransactions[0].entries).toHaveLength(2);
    expect(
      ledgerTransactions[0].entries.reduce(
        (total, entry) =>
          total +
          (entry.direction === LedgerEntryDirection.DEBIT
            ? entry.amountTambala
            : 0n),
        0n,
      ),
    ).toBe(1_000_000n);
    expect(
      ledgerTransactions[0].entries.reduce(
        (total, entry) =>
          total +
          (entry.direction === LedgerEntryDirection.CREDIT
            ? entry.amountTambala
            : 0n),
        0n,
      ),
    ).toBe(1_000_000n);
  });

  it('rolls back payment and attempt transitions if ledger posting fails', async () => {
    const fixture = await createCryptoPaymentFixture();
    await database.ledgerAccount.update({
      where: { key: clearingAccountKey },
      data: { status: LedgerAccountStatus.FROZEN },
    });

    try {
      await expect(
        webhookService.handleVerifiedCallback({
          payment_id: fixture.nowPaymentsId,
          payment_status: 'finished',
        }),
      ).rejects.toThrow('Ledger account is not active');
    } finally {
      await database.ledgerAccount.update({
        where: { key: clearingAccountKey },
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
      database.ledgerTransaction.count({
        where: {
          sourceType: 'PAYMENT',
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
        amountTambala: 1_000_000,
        currency: 'MWK',
        feeTambala: 0n,
        merchantNetTambala: 1_000_000n,
        feeType: FeeType.ZERO,
        feePercentageBps: 0,
        feeFixedTambala: 0n,
        feePolicyId,
        feePolicyVersion: 1,
        status: PaymentStatus.PROCESSING,
        provider: PaymentProvider.NOWPAYMENTS,
        providerReference: `np-${suffix}`,
        idempotencyKey: `crypto-${suffix}`,
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
    await database.cryptoPaymentDetail.create({
      data: {
        attemptId: attempt.id,
        nowpaymentsPaymentId: `np-${suffix}`,
        payCurrency: 'btc',
        payAmount: '0.00012',
        priceCurrency: 'usd',
        priceAmount: '7.00',
        fxRateMwkToPriceCurrency: '0.0007',
        fxRateCapturedAt: new Date(),
        paymentAddress: `wallet-${suffix}`,
        lastReportedStatus: 'waiting',
      },
    });

    return {
      paymentId: payment.id,
      attemptId: attempt.id,
      nowPaymentsId: `np-${suffix}`,
    };
  }
});
