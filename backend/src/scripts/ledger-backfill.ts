import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createFileLogger, flushFileLogger } from '../logging/file-logger.js';
import { LedgerTransactionStatus, PaymentStatus } from '../generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';
import { LedgerPostingService } from '../ledger/ledger-posting.service.js';
import { assessLegacyPayment, nonzeroLegacyMerchantLedgers } from '../ledger/legacy-backfill.js';

const logger = createFileLogger('ledger-backfill');
const apply = process.argv.includes('--apply');
const requestedReportPath = process.argv.find((arg) => arg.startsWith('--report='))?.slice('--report='.length);
const runAt = new Date();
const timestamp = runAt.toISOString().replaceAll(':', '-');
const reportPath = resolve(requestedReportPath ?? resolve(process.env.LOG_DIR ?? 'logs', `ledger-backfill-${timestamp}.json`));

function asString(value: bigint | number | null | undefined): string {
  return String(value ?? 0);
}

async function main(): Promise<void> {
  const database = new DatabaseService();
  const ledger = new LedgerPostingService();
  try {
    const payments = await database.paymentTransaction.findMany({
      include: {
        attempts: true,
        merchant: { select: { id: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const legacyLedgerRecords = await database.merchantLedger.findMany({
      where: {
        OR: [{ availableBalance: { not: 0 } }, { pendingBalance: { not: 0 } }],
      },
      select: {
        merchantId: true,
        currency: true,
        availableBalance: true,
        pendingBalance: true,
        updatedAt: true,
      },
    });
    const legacyLedgers = nonzeroLegacyMerchantLedgers(legacyLedgerRecords);

    const successfulPayments = payments.filter((payment) => payment.status === PaymentStatus.SUCCEEDED);
    const existingPostings = successfulPayments.length
      ? await database.ledgerTransaction.findMany({
          where: {
            sourceType: 'PAYMENT',
            sourceId: { in: successfulPayments.map((payment) => payment.id) },
            postingPurpose: 'SUCCESS',
          },
          select: { sourceId: true, status: true },
        })
      : [];
    const postingByPaymentId = new Map(existingPostings.map((posting) => [posting.sourceId, posting]));

    const eligible: typeof payments = [];
    const excluded: Array<{ paymentReference: string; paymentId: string; reason: string }> = [];
    for (const payment of payments) {
      const providerAccount = payment.status === PaymentStatus.SUCCEEDED && payment.provider
        ? await database.ledgerAccount.findUnique({
            where: { key: `provider-clearing:${payment.currency}:${payment.provider}` },
            select: { status: true, code: true, currency: true, provider: true, merchantId: true },
          })
        : null;
      const reason = assessLegacyPayment(payment, providerAccount);
      if (reason) excluded.push({ paymentReference: payment.publicReference, paymentId: payment.id, reason });
      else eligible.push(payment);
    }

    const alreadyPosted = eligible.filter((payment) => {
      const posting = postingByPaymentId.get(payment.id);
      return posting?.status === LedgerTransactionStatus.POSTED;
    });
    const incompletePosting = eligible.filter((payment) => {
      const posting = postingByPaymentId.get(payment.id);
      return posting && posting.status !== LedgerTransactionStatus.POSTED;
    });
    for (const payment of incompletePosting) {
      excluded.push({
        paymentReference: payment.publicReference,
        paymentId: payment.id,
        reason: 'EXISTING_LEDGER_POSTING_NOT_POSTED',
      });
    }
    const toPost = eligible.filter((payment) =>
      !postingByPaymentId.has(payment.id),
    );

    let eligibleAmount = 0n;
    let postedAmount = 0n;
    let plannedMerchantNet = 0n;
    for (const payment of eligible) eligibleAmount += BigInt(payment.amountTambala);
    for (const payment of alreadyPosted) postedAmount += BigInt(payment.amountTambala);
    for (const payment of toPost) plannedMerchantNet += payment.merchantNetTambala;

    const existingPendingBalances = await database.ledgerAccountBalance.findMany({
      where: { account: { code: 'MERCHANT_PENDING' } },
      include: { account: { select: { merchantId: true, currency: true } } },
    });

    const pendingByMerchant: Record<string, string> = {};
    for (const balance of existingPendingBalances) {
      const merchantId = balance.account.merchantId;
      if (!merchantId) continue;
      const creditNormal = balance.creditTotal - balance.debitTotal;
      const key = `${merchantId}:${balance.account.currency}`;
      pendingByMerchant[key] = asString(BigInt(pendingByMerchant[key] ?? '0') + creditNormal);
    }

    const projectedPendingBalances = { ...pendingByMerchant };
    for (const payment of toPost) {
      const key = `${payment.merchantId}:${payment.currency}`;
      projectedPendingBalances[key] = asString(
        BigInt(projectedPendingBalances[key] ?? '0') + payment.merchantNetTambala,
      );
    }

    const posted: string[] = [];
    const failed: Array<{ paymentReference: string; error: string }> = [];
    if (apply) {
      for (const payment of toPost) {
        try {
          await database.$transaction(async (tx) => {
            await ledger.postSuccessfulPayment(tx, {
              paymentId: payment.id,
              publicReference: payment.publicReference,
              merchantId: payment.merchantId,
              provider: payment.provider!,
              amountTambala: BigInt(payment.amountTambala),
              feeTambala: payment.feeTambala,
              merchantNetTambala: payment.merchantNetTambala,
              currency: payment.currency,
              source: 'HISTORICAL_BACKFILL',
              backfilledAt: runAt,
            });
          });
          posted.push(payment.publicReference);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown posting error';
          failed.push({ paymentReference: payment.publicReference, error: message });
          logger.error({ paymentReference: payment.publicReference, err: error }, 'Historical payment posting failed; safe to retry');
        }
      }
    }

    let resultingPendingBalances = projectedPendingBalances;
    if (apply) {
      const balancesAfterApply = await database.ledgerAccountBalance.findMany({
        where: { account: { code: 'MERCHANT_PENDING' } },
        include: { account: { select: { merchantId: true, currency: true } } },
      });
      resultingPendingBalances = {};
      for (const balance of balancesAfterApply) {
        const merchantId = balance.account.merchantId;
        if (!merchantId) continue;
        const key = `${merchantId}:${balance.account.currency}`;
        const balanceAmount = balance.creditTotal - balance.debitTotal;
        resultingPendingBalances[key] = asString(
          BigInt(resultingPendingBalances[key] ?? '0') + balanceAmount,
        );
      }
    }

    const report = {
      generatedAt: runAt.toISOString(),
      mode: apply ? 'APPLY' : 'DRY_RUN',
      counts: {
        totalPaymentsScanned: payments.length,
        successfulPaymentsScanned: successfulPayments.length,
        eligible: eligible.length,
        alreadyPosted: alreadyPosted.length,
        wouldPostOrPosted: toPost.length,
        postedThisRun: posted.length,
        failed: failed.length,
        excluded: excluded.length,
        nonzeroLegacyMerchantLedgers: legacyLedgers.length,
      },
      totalsTambala: {
        eligiblePaymentGross: asString(eligibleAmount),
        alreadyPostedPaymentGross: asString(postedAmount),
        merchantNetToPost: asString(plannedMerchantNet),
      },
      existingMerchantPendingBalancesTambala: pendingByMerchant,
      resultingOrProjectedMerchantPendingBalancesTambala: resultingPendingBalances,
      legacyMerchantLedgers: legacyLedgers.map((record) => ({
        merchantId: record.merchantId,
        currency: record.currency,
        availableBalanceTambala: String(record.availableBalance),
        pendingBalanceTambala: String(record.pendingBalance),
        updatedAt: record.updatedAt.toISOString(),
      })),
      excluded,
      postedPaymentReferences: posted,
      failedPostings: failed,
      reconciliationNotice:
        'A balanced ledger does not prove merchant availability. Reconcile legacy settlements, withdrawals, refunds, and adjustments before using reconstructed balances as authoritative.',
    };

    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
    logger.info({ reportPath, mode: report.mode, counts: report.counts }, 'Ledger backfill report written');
  } finally {
    await database.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  logger.error({ err: error, reportPath, mode: apply ? 'APPLY' : 'DRY_RUN' }, 'Ledger backfill failed');
  process.exitCode = 1;
} finally {
  await flushFileLogger(logger);
}
