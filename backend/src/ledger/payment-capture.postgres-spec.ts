import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import {
  FeeType,
  LedgerAccountStatus,
  LedgerEntryDirection,
  LedgerTransactionStatus,
  PaymentAttemptStatus,
  PaymentProvider,
  PaymentStatus,
} from '../generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';
import { createFeePolicyVersion } from './fee-policy-management.js';
import { FeePolicyService } from './fee-policy.service.js';
import { CryptoLedgerPostingService } from './crypto-ledger-posting.service.js';
import { LedgerPostingService } from './ledger-posting.service.js';
import { ProviderCallbackStatus } from '../provider-callbacks/dto/provider-callback.dto.js';
import { ProviderCallbacksService } from '../provider-callbacks/provider-callbacks.service.js';

const signingSecret = 'ledger-postgres-integration-test-secret';
const paymentAmountTambala = 10_000;

describe('payment capture PostgreSQL integration', () => {
  let database: DatabaseService;
  let callbacks: ProviderCallbacksService;
  let originalDatabaseUrl: string | undefined;
  let originalSigningSecret: string | undefined;
  let originalNodeEnv: string | undefined;

  beforeAll(async () => {
    const testDatabaseUrl = process.env.LEDGER_TEST_DATABASE_URL;
    if (!testDatabaseUrl) {
      throw new Error(
        'LEDGER_TEST_DATABASE_URL is required; integration tests never fall back to DATABASE_URL.',
      );
    }

    const databaseName = decodeURIComponent(
      new URL(testDatabaseUrl).pathname.slice(1),
    );
    if (!/(^|[_-])test([_-]|$)/i.test(databaseName)) {
      throw new Error(
        'LEDGER_TEST_DATABASE_URL must point to a dedicated database whose name contains "test".',
      );
    }

    originalDatabaseUrl = process.env.DATABASE_URL;
    originalSigningSecret = process.env.SIGNING_SECRET;
    originalNodeEnv = process.env.NODE_ENV;
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.SIGNING_SECRET = signingSecret;
    process.env.NODE_ENV = 'test';

    database = new DatabaseService();
    await database.$connect();

    const [policy, providerAccount] = await Promise.all([
      database.feePolicy.findFirst({
        where: { merchantId: null, currency: 'MWK', active: true },
        select: {
          type: true,
          percentageBps: true,
          fixedAmountTambala: true,
        },
      }),
      database.ledgerAccount.findUnique({
        where: { key: 'provider-clearing:MWK:TEST' },
        select: { id: true, status: true },
      }),
    ]);

    if (
      !policy ||
      policy.type !== FeeType.ZERO ||
      policy.percentageBps !== 0 ||
      policy.fixedAmountTambala !== 0n
    ) {
      throw new Error(
        'The active platform ZERO/MWK fee policy is missing or invalid; deploy migrations first.',
      );
    }
    if (
      !providerAccount ||
      providerAccount.status !== LedgerAccountStatus.ACTIVE
    ) {
      throw new Error(
        'The active MWK TEST provider-clearing account is missing; deploy migrations first.',
      );
    }

    callbacks = new ProviderCallbacksService(
      database,
      new LedgerPostingService(),
      new CryptoLedgerPostingService(),
      new ConfigService({ NOWPAYMENTS_FEE_BPS: 0 }),
    );
  });

  afterAll(async () => {
    await database?.$disconnect();
    restoreEnvironmentVariable('DATABASE_URL', originalDatabaseUrl);
    restoreEnvironmentVariable('SIGNING_SECRET', originalSigningSecret);
    restoreEnvironmentVariable('NODE_ENV', originalNodeEnv);
  });

  it('posts one balanced ledger transaction for concurrent duplicate successful callbacks', async () => {
    const fixture = await createPaymentFixture();

    const results = await Promise.all([
      processSuccessfulCallback(fixture),
      processSuccessfulCallback(fixture),
    ]);

    expect(
      results
        .map((result) => result.duplicate)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);
    const posting = await findPosting(fixture.paymentId);
    expect(posting.status).toBe(LedgerTransactionStatus.POSTED);
    expect(posting.entries).toHaveLength(2);
    expect(new Set(posting.entries.map((entry) => entry.direction))).toEqual(
      new Set([LedgerEntryDirection.DEBIT, LedgerEntryDirection.CREDIT]),
    );
    expect(posting.entries.every((entry) => entry.amountTambala > 0n)).toBe(
      true,
    );
    expect(
      posting.entries.every(
        (entry) => entry.account.currency === posting.currency,
      ),
    ).toBe(true);
    expect(
      posting.entries.reduce(
        (total, entry) =>
          total +
          (entry.direction === LedgerEntryDirection.DEBIT
            ? entry.amountTambala
            : 0n),
        0n,
      ),
    ).toBe(BigInt(paymentAmountTambala));
    expect(
      posting.entries.reduce(
        (total, entry) =>
          total +
          (entry.direction === LedgerEntryDirection.CREDIT
            ? entry.amountTambala
            : 0n),
        0n,
      ),
    ).toBe(BigInt(paymentAmountTambala));

    for (const accountId of new Set(
      posting.entries.map((entry) => entry.accountId),
    )) {
      await expectProjectionToMatchPostedEntries(accountId);
    }

    const merchantAccount = await database.ledgerAccount.findUniqueOrThrow({
      where: { key: `merchant-pending:MWK:${fixture.merchantId}` },
      include: { balance: true },
    });
    expect(merchantAccount.balance?.creditTotal).toBe(
      BigInt(paymentAmountTambala),
    );
    expect(merchantAccount.balance?.debitTotal).toBe(0n);
  });

  it('enforces source and purpose uniqueness in PostgreSQL without changing the original posting', async () => {
    const fixture = await createPaymentFixture();
    await processSuccessfulCallback(fixture);

    const original = await findPosting(fixture.paymentId);
    const originalEntries = original.entries.map((entry) => ({
      id: entry.id,
      accountId: entry.accountId,
      direction: entry.direction,
      amountTambala: entry.amountTambala,
    }));

    await expect(
      database.ledgerTransaction.create({
        data: {
          reference: `led_${randomUUID().replaceAll('-', '')}`,
          sourceType: 'PAYMENT',
          sourceId: fixture.paymentId,
          postingPurpose: 'SUCCESS',
          type: 'PAYMENT_CAPTURE',
          currency: 'MWK',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const afterDuplicateAttempt = await findPosting(fixture.paymentId);
    expect(afterDuplicateAttempt.id).toBe(original.id);
    expect(
      afterDuplicateAttempt.entries.map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        direction: entry.direction,
        amountTambala: entry.amountTambala,
      })),
    ).toEqual(originalEntries);
  });

  it('rolls back payment and attempt updates when ledger posting fails', async () => {
    const fixture = await createPaymentFixture();
    const providerAccount = await database.ledgerAccount.findUniqueOrThrow({
      where: { key: 'provider-clearing:MWK:TEST' },
    });
    expect(providerAccount.status).toBe(LedgerAccountStatus.ACTIVE);
    const balanceBefore = await database.ledgerAccountBalance.findUnique({
      where: { accountId: providerAccount.id },
    });

    await database.ledgerAccount.update({
      where: { id: providerAccount.id },
      data: { status: LedgerAccountStatus.FROZEN },
    });

    try {
      await expect(processSuccessfulCallback(fixture)).rejects.toThrow(
        'Ledger account is not active',
      );

      const [payment, attempt, postings] = await Promise.all([
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
        }),
      ]);
      expect(payment.status).toBe(PaymentStatus.PROCESSING);
      expect(attempt.status).toBe(PaymentAttemptStatus.PROCESSING);
      expect(postings).toHaveLength(0);
      expect(
        await database.ledgerEntry.count({
          where: {
            ledgerTransaction: {
              is: {
                sourceType: 'PAYMENT',
                sourceId: fixture.paymentId,
                postingPurpose: 'SUCCESS',
              },
            },
          },
        }),
      ).toBe(0);
      expect(
        await database.ledgerAccountBalance.findUnique({
          where: { accountId: providerAccount.id },
        }),
      ).toEqual(balanceBefore);
    } finally {
      await database.ledgerAccount.update({
        where: { id: providerAccount.id },
        data: { status: providerAccount.status },
      });
    }
  });

  it('keeps balance projections equal to independently summed posted entries', async () => {
    const fixture = await createPaymentFixture({
      type: FeeType.PERCENTAGE,
      percentageBps: 250,
      fixedAmountTambala: 0n,
    });
    await processSuccessfulCallback(fixture);

    const posting = await findPosting(fixture.paymentId);
    expect(
      posting.entries
        .map((entry) => ({
          code: entry.account.code,
          direction: entry.direction,
          amountTambala: entry.amountTambala,
          currency: entry.account.currency,
        }))
        .sort((left, right) => left.code.localeCompare(right.code)),
    ).toEqual([
      {
        code: 'MERCHANT_PENDING',
        direction: LedgerEntryDirection.CREDIT,
        amountTambala: 9_750n,
        currency: 'MWK',
      },
      {
        code: 'PLATFORM_FEE_REVENUE',
        direction: LedgerEntryDirection.CREDIT,
        amountTambala: 250n,
        currency: 'MWK',
      },
      {
        code: 'PROVIDER_CLEARING',
        direction: LedgerEntryDirection.DEBIT,
        amountTambala: 10_000n,
        currency: 'MWK',
      },
    ]);
    for (const accountId of new Set(
      posting.entries.map((entry) => entry.accountId),
    )) {
      await expectProjectionToMatchPostedEntries(accountId);
    }
  });

  it('prevents updates and deletes to posted transactions and entries', async () => {
    const fixture = await createPaymentFixture();
    await processSuccessfulCallback(fixture);
    const posting = await findPosting(fixture.paymentId);
    const entry = posting.entries[0];

    await expect(
      database.ledgerEntry.update({
        where: { id: entry.id },
        data: { amountTambala: entry.amountTambala + 1n },
      }),
    ).rejects.toThrow();
    await expect(
      database.ledgerEntry.delete({ where: { id: entry.id } }),
    ).rejects.toThrow();
    await expect(
      database.ledgerTransaction.update({
        where: { id: posting.id },
        data: { description: 'mutated posted transaction' },
      }),
    ).rejects.toThrow();

    const unchanged = await findPosting(fixture.paymentId);
    expect(unchanged.entries.map((item) => item.id)).toEqual(
      posting.entries.map((item) => item.id),
    );
  });

  it('treats a successful callback after commit as a duplicate without changing entries or balances', async () => {
    const fixture = await createPaymentFixture();
    await processSuccessfulCallback(fixture);

    const original = await findPosting(fixture.paymentId);
    const originalEntries = original.entries.map((entry) => ({
      id: entry.id,
      accountId: entry.accountId,
      direction: entry.direction,
      amountTambala: entry.amountTambala,
    }));
    const accountIds = [
      ...new Set(original.entries.map((entry) => entry.accountId)),
    ];
    const originalBalances = await database.ledgerAccountBalance.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { accountId: 'asc' },
    });

    await expect(processSuccessfulCallback(fixture)).resolves.toEqual({
      received: true,
      duplicate: true,
    });

    const afterDuplicate = await findPosting(fixture.paymentId);
    const afterBalances = await database.ledgerAccountBalance.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { accountId: 'asc' },
    });
    expect(
      afterDuplicate.entries.map((entry) => ({
        id: entry.id,
        accountId: entry.accountId,
        direction: entry.direction,
        amountTambala: entry.amountTambala,
      })),
    ).toEqual(originalEntries);
    expect(
      afterBalances.map((balance) => ({
        accountId: balance.accountId,
        debitTotal: balance.debitTotal,
        creditTotal: balance.creditTotal,
      })),
    ).toEqual(
      originalBalances.map((balance) => ({
        accountId: balance.accountId,
        debitTotal: balance.debitTotal,
        creditTotal: balance.creditTotal,
      })),
    );
  });

  it('preserves persisted fee snapshots across policy changes and rejects snapshot edits', async () => {
    const merchant = await createMerchant();
    const firstPolicy = await database.$transaction((tx) =>
      createFeePolicyVersion(tx, {
        merchantId: merchant.id,
        currency: 'MWK',
        type: FeeType.PERCENTAGE,
        percentageBps: 250,
        fixedAmountTambala: 0n,
        version: 1,
        source: 'postgres integration test v1',
        activate: true,
      }),
    );
    const snapshot = await database.$transaction(async (tx) => {
      const fee = await new FeePolicyService().snapshotForPayment(tx, {
        merchantId: merchant.id,
        currency: 'MWK',
        amountTambala: BigInt(paymentAmountTambala),
      });
      const payment = await tx.paymentTransaction.create({
        data: {
          publicReference: `sp_it_${randomUUID().replaceAll('-', '')}`,
          merchantId: merchant.id,
          amountTambala: paymentAmountTambala,
          currency: 'MWK',
          ...fee,
          idempotencyKey: `it_${randomUUID()}`,
        },
      });
      return { paymentId: payment.id, fee };
    });

    expect(snapshot.fee.feeTambala).toBe(250n);
    expect(snapshot.fee.merchantNetTambala).toBe(9_750n);
    expect(snapshot.fee.feePolicyId).toBe(firstPolicy.id);

    await database.$transaction((tx) =>
      createFeePolicyVersion(tx, {
        merchantId: merchant.id,
        currency: 'MWK',
        type: FeeType.FIXED,
        percentageBps: 0,
        fixedAmountTambala: 100n,
        version: 2,
        source: 'postgres integration test v2',
        activate: true,
      }),
    );

    await expect(
      database.paymentTransaction.update({
        where: { id: snapshot.paymentId },
        data: { feeTambala: 251n },
      }),
    ).rejects.toThrow();

    const [persistedPayment, nextSnapshot] = await Promise.all([
      database.paymentTransaction.findUniqueOrThrow({
        where: { id: snapshot.paymentId },
      }),
      database.$transaction((tx) =>
        new FeePolicyService().snapshotForPayment(tx, {
          merchantId: merchant.id,
          currency: 'MWK',
          amountTambala: BigInt(paymentAmountTambala),
        }),
      ),
    ]);
    expect(persistedPayment.feeTambala).toBe(250n);
    expect(persistedPayment.merchantNetTambala).toBe(9_750n);
    expect(persistedPayment.feePolicyId).toBe(firstPolicy.id);
    expect(persistedPayment.feePolicyVersion).toBe(1);
    expect(nextSnapshot.feeType).toBe(FeeType.FIXED);
    expect(nextSnapshot.feeTambala).toBe(100n);
  });

  async function createMerchant() {
    const id = randomUUID();
    return database.merchant.create({
      data: {
        name: `Ledger integration ${id}`,
        email: `ledger-integration-${id}@example.test`,
        passwordHash: 'integration-test-only',
        phone: `+265${id.replaceAll('-', '').slice(0, 9)}`,
      },
    });
  }

  async function createPaymentFixture(feePolicy?: {
    type: FeeType;
    percentageBps: number;
    fixedAmountTambala: bigint;
  }) {
    const merchant = await createMerchant();
    if (feePolicy) {
      await database.$transaction((tx) =>
        createFeePolicyVersion(tx, {
          merchantId: merchant.id,
          currency: 'MWK',
          ...feePolicy,
          version: 1,
          source: 'postgres payment capture integration',
          activate: true,
        }),
      );
    }
    const feeSnapshot = await database.$transaction((tx) =>
      new FeePolicyService().snapshotForPayment(tx, {
        merchantId: merchant.id,
        currency: 'MWK',
        amountTambala: BigInt(paymentAmountTambala),
      }),
    );
    const payment = await database.paymentTransaction.create({
      data: {
        publicReference: `sp_it_${randomUUID().replaceAll('-', '')}`,
        merchantId: merchant.id,
        amountTambala: paymentAmountTambala,
        currency: 'MWK',
        ...feeSnapshot,
        idempotencyKey: `it_${randomUUID()}`,
        status: PaymentStatus.PROCESSING,
        provider: PaymentProvider.TEST,
      },
    });
    const attempt = await database.paymentAttempt.create({
      data: {
        transactionId: payment.id,
        attemptNumber: 1,
        provider: PaymentProvider.TEST,
        status: PaymentAttemptStatus.PROCESSING,
      },
    });
    return {
      merchantId: merchant.id,
      paymentId: payment.id,
      publicReference: payment.publicReference,
      attemptId: attempt.id,
      providerReference: `provider-it-${randomUUID()}`,
    };
  }

  async function processSuccessfulCallback(
    fixture: Awaited<ReturnType<typeof createPaymentFixture>>,
  ) {
    const body = {
      event: 'payment.updated',
      providerReference: fixture.providerReference,
      transactionReference: fixture.publicReference,
      attemptReference: fixture.attemptId,
      amount: paymentAmountTambala / 100,
      currency: 'MWK',
      provider: PaymentProvider.TEST,
      status: ProviderCallbackStatus.SUCCESSFUL,
      occurredAt: new Date().toISOString(),
    };
    const timestamp = String(Date.now());
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createHmac('sha256', signingSecret)
      .update(`${timestamp}.${rawBody.toString('utf8')}`)
      .digest('hex');
    return callbacks.handleCallback({ body, rawBody, timestamp, signature });
  }

  async function findPosting(paymentId: string) {
    const posting = await database.ledgerTransaction.findUnique({
      where: {
        sourceType_sourceId_postingPurpose: {
          sourceType: 'PAYMENT',
          sourceId: paymentId,
          postingPurpose: 'SUCCESS',
        },
      },
      include: { entries: { include: { account: true } } },
    });
    if (!posting)
      throw new Error(`Missing payment-success posting for ${paymentId}`);
    return posting;
  }

  async function expectProjectionToMatchPostedEntries(accountId: string) {
    const [projection, debitEntries, creditEntries] = await Promise.all([
      database.ledgerAccountBalance.findUnique({ where: { accountId } }),
      database.ledgerEntry.aggregate({
        where: {
          accountId,
          direction: LedgerEntryDirection.DEBIT,
          ledgerTransaction: { is: { status: LedgerTransactionStatus.POSTED } },
        },
        _sum: { amountTambala: true },
      }),
      database.ledgerEntry.aggregate({
        where: {
          accountId,
          direction: LedgerEntryDirection.CREDIT,
          ledgerTransaction: { is: { status: LedgerTransactionStatus.POSTED } },
        },
        _sum: { amountTambala: true },
      }),
    ]);

    if (!projection)
      throw new Error(`Missing balance projection for account ${accountId}`);
    expect(projection.debitTotal).toBe(debitEntries._sum.amountTambala ?? 0n);
    expect(projection.creditTotal).toBe(creditEntries._sum.amountTambala ?? 0n);
  }

  function restoreEnvironmentVariable(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
