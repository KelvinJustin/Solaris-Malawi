import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../generated/prisma/client.js';
import {
  LedgerAccountStatus,
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
  LedgerTransactionStatus,
  LedgerTransactionType,
  PaymentProvider,
} from '../generated/prisma/enums.js';

interface SuccessfulPaymentPosting {
  paymentId: string;
  publicReference: string;
  merchantId: string;
  provider: PaymentProvider;
  amountTambala: bigint;
  feeTambala: bigint;
  merchantNetTambala: bigint;
  currency: string;
  source: 'CALLBACK' | 'HISTORICAL_BACKFILL';
  backfilledAt?: Date;
}

interface PostingEntry {
  accountId: string;
  direction: LedgerEntryDirection;
  amountTambala: bigint;
}

export interface ProviderSettlementPosting {
  batchId: string;
  batchReference: string;
  provider: PaymentProvider;
  currency: string;
  grossAmountTambala: bigint;
  providerFeeAmountTambala: bigint;
  expectedNetAmountTambala: bigint;
  bankReceipts: {
    bankAccountId: string;
    bankAccountName: string;
    amountTambala: bigint;
  }[];
}

@Injectable()
export class LedgerPostingService {
  async postSuccessfulPayment(
    tx: Prisma.TransactionClient,
    payment: SuccessfulPaymentPosting,
  ) {
    if (
      payment.amountTambala <= 0n ||
      payment.feeTambala < 0n ||
      payment.merchantNetTambala <= 0n ||
      payment.feeTambala + payment.merchantNetTambala !== payment.amountTambala
    ) {
      throw new InternalServerErrorException('Payment fee snapshot is invalid');
    }

    const existing = await tx.ledgerTransaction.findUnique({
      where: {
        sourceType_sourceId_postingPurpose: {
          sourceType: 'PAYMENT',
          sourceId: payment.paymentId,
          postingPurpose: 'SUCCESS',
        },
      },
      include: { entries: true },
    });
    if (existing) {
      if (existing.status !== LedgerTransactionStatus.POSTED) {
        throw new InternalServerErrorException('Existing payment ledger posting is not posted');
      }
      return existing;
    }

    const providerAccountInput = {
      key: `provider-clearing:${payment.currency}:${payment.provider}`,
      code: 'PROVIDER_CLEARING',
      name: `${payment.provider} clearing`,
      type: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: payment.currency,
      provider: payment.provider,
    };
    const providerAccount = await tx.ledgerAccount.findUnique({
      where: { key: providerAccountInput.key },
    });
    if (!providerAccount) {
      throw new InternalServerErrorException('Provider clearing account mapping is missing');
    }
    this.assertAccount(providerAccount, providerAccountInput);
    const merchantAccount = await this.ensureAccount(tx, {
      key: `merchant-pending:${payment.currency}:${payment.merchantId}`,
      code: 'MERCHANT_PENDING',
      name: `Merchant pending settlement ${payment.merchantId}`,
      type: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      currency: payment.currency,
      merchantId: payment.merchantId,
    });

    const entries: PostingEntry[] = [
      {
        accountId: providerAccount.id,
        direction: LedgerEntryDirection.DEBIT,
        amountTambala: payment.amountTambala,
      },
      {
        accountId: merchantAccount.id,
        direction: LedgerEntryDirection.CREDIT,
        amountTambala: payment.merchantNetTambala,
      },
    ];

    if (payment.feeTambala > 0n) {
      const feeAccount = await this.ensureAccount(tx, {
        key: `platform-fee-revenue:${payment.currency}`,
        code: 'PLATFORM_FEE_REVENUE',
        name: 'Platform fee revenue',
        type: LedgerAccountType.REVENUE,
        normalBalance: LedgerNormalBalance.CREDIT,
        currency: payment.currency,
      });
      entries.push({
        accountId: feeAccount.id,
        direction: LedgerEntryDirection.CREDIT,
        amountTambala: payment.feeTambala,
      });
    }

    return this.postEntries(tx, {
      sourceType: 'PAYMENT',
      sourceId: payment.paymentId,
      postingPurpose: 'SUCCESS',
      type: LedgerTransactionType.PAYMENT_CAPTURE,
      currency: payment.currency,
      description: `Successful payment ${payment.publicReference}`,
      provenance: payment.source,
      backfilledAt: payment.backfilledAt,
      entries,
    });
  }

  async postProviderSettlement(
    tx: Prisma.TransactionClient,
    settlement: ProviderSettlementPosting,
  ) {
    if (
      settlement.grossAmountTambala <= 0n ||
      settlement.providerFeeAmountTambala < 0n ||
      settlement.expectedNetAmountTambala <= 0n ||
      settlement.providerFeeAmountTambala +
        settlement.expectedNetAmountTambala !==
        settlement.grossAmountTambala
    ) {
      throw new InternalServerErrorException(
        'Provider settlement totals are invalid',
      );
    }

    const existing = await tx.ledgerTransaction.findUnique({
      where: {
        sourceType_sourceId_postingPurpose: {
          sourceType: 'PROVIDER_SETTLEMENT',
          sourceId: settlement.batchId,
          postingPurpose: 'BANK_RECEIPT',
        },
      },
      include: { entries: true },
    });
    if (existing) {
      if (existing.status !== LedgerTransactionStatus.POSTED) {
        throw new InternalServerErrorException(
          'Existing provider settlement posting is not posted',
        );
      }
      return existing;
    }

    const providerAccountInput = {
      key: `provider-clearing:${settlement.currency}:${settlement.provider}`,
      code: 'PROVIDER_CLEARING',
      name: `${settlement.provider} clearing`,
      type: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      currency: settlement.currency,
      provider: settlement.provider,
    };
    const providerAccount = await tx.ledgerAccount.findUnique({
      where: { key: providerAccountInput.key },
    });
    if (!providerAccount) {
      throw new InternalServerErrorException(
        'Provider clearing account mapping is missing',
      );
    }
    this.assertAccount(providerAccount, providerAccountInput);

    const bankTotal = settlement.bankReceipts.reduce(
      (total, receipt) => total + receipt.amountTambala,
      0n,
    );
    if (
      settlement.bankReceipts.length === 0 ||
      settlement.bankReceipts.some((receipt) => receipt.amountTambala <= 0n) ||
      bankTotal !== settlement.expectedNetAmountTambala
    ) {
      throw new InternalServerErrorException(
        'Provider settlement bank receipt allocations are invalid',
      );
    }

    const entries: PostingEntry[] = [];
    for (const receipt of settlement.bankReceipts) {
      const bankAccount = await this.ensureAccount(tx, {
        key: `platform-bank-cash:${settlement.currency}:${receipt.bankAccountId}`,
        code: 'PLATFORM_BANK_CASH',
        name: `Platform bank cash ${receipt.bankAccountName}`,
        type: LedgerAccountType.ASSET,
        normalBalance: LedgerNormalBalance.DEBIT,
        currency: settlement.currency,
      });
      entries.push({
        accountId: bankAccount.id,
        direction: LedgerEntryDirection.DEBIT,
        amountTambala: receipt.amountTambala,
      });
    }

    if (settlement.providerFeeAmountTambala > 0n) {
      const expenseAccount = await this.ensureAccount(tx, {
        key: `provider-processing-expense:${settlement.currency}:${settlement.provider}`,
        code: 'PROVIDER_PROCESSING_EXPENSE',
        name: `${settlement.provider} processing expense`,
        type: LedgerAccountType.EXPENSE,
        normalBalance: LedgerNormalBalance.DEBIT,
        currency: settlement.currency,
        provider: settlement.provider,
      });
      entries.push({
        accountId: expenseAccount.id,
        direction: LedgerEntryDirection.DEBIT,
        amountTambala: settlement.providerFeeAmountTambala,
      });
    }

    entries.push({
      accountId: providerAccount.id,
      direction: LedgerEntryDirection.CREDIT,
      amountTambala: settlement.grossAmountTambala,
    });
    return this.postEntries(tx, {
      sourceType: 'PROVIDER_SETTLEMENT',
      sourceId: settlement.batchId,
      postingPurpose: 'BANK_RECEIPT',
      type: LedgerTransactionType.PROVIDER_SETTLEMENT,
      currency: settlement.currency,
      description: `Provider settlement ${settlement.batchReference}`,
      provenance: 'RECONCILED_BANK_STATEMENT',
      entries,
    });
  }

  private async postEntries(
    tx: Prisma.TransactionClient,
    input: {
      sourceType: string;
      sourceId: string;
      postingPurpose: string;
      type: LedgerTransactionType;
      currency: string;
      description: string;
      provenance: string;
      backfilledAt?: Date;
      entries: PostingEntry[];
    },
  ) {
    this.assertBalanced(input.entries);
    const ledgerTransaction = await tx.ledgerTransaction.create({
      data: {
        reference: `led_${randomUUID().replaceAll('-', '')}`,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        postingPurpose: input.postingPurpose,
        type: input.type,
        status: LedgerTransactionStatus.PENDING,
        currency: input.currency,
        description: input.description,
        provenance: input.provenance,
        backfilledAt: input.backfilledAt,
      },
    });

    await tx.ledgerEntry.createMany({
      data: input.entries.map((entry) => ({
        ledgerTransactionId: ledgerTransaction.id,
        ...entry,
      })),
    });

    for (const entry of input.entries) {
      await tx.ledgerAccountBalance.upsert({
        where: { accountId: entry.accountId },
        create: {
          accountId: entry.accountId,
          debitTotal:
            entry.direction === LedgerEntryDirection.DEBIT
              ? entry.amountTambala
              : 0n,
          creditTotal:
            entry.direction === LedgerEntryDirection.CREDIT
              ? entry.amountTambala
              : 0n,
        },
        update: {
          debitTotal: {
            increment:
              entry.direction === LedgerEntryDirection.DEBIT
                ? entry.amountTambala
                : 0n,
          },
          creditTotal: {
            increment:
              entry.direction === LedgerEntryDirection.CREDIT
                ? entry.amountTambala
                : 0n,
          },
        },
      });
    }

    return tx.ledgerTransaction.update({
      where: { id: ledgerTransaction.id },
      data: {
        status: LedgerTransactionStatus.POSTED,
        postedAt: new Date(),
      },
      include: { entries: true },
    });
  }

  private async ensureAccount(
    tx: Prisma.TransactionClient,
    input: {
      key: string;
      code: string;
      name: string;
      type: LedgerAccountType;
      normalBalance: LedgerNormalBalance;
      currency: string;
      merchantId?: string;
      provider?: PaymentProvider;
    },
  ) {
    const account = await tx.ledgerAccount.upsert({
      where: { key: input.key },
      create: {
        ...input,
        provider: input.provider ?? null,
        merchantId: input.merchantId ?? null,
      },
      update: {},
    });

    this.assertAccount(account, input);
    return account;
  }

  private assertAccount(
    account: {
      status: LedgerAccountStatus;
      code: string;
      type: LedgerAccountType;
      normalBalance: LedgerNormalBalance;
      currency: string;
      merchantId: string | null;
      provider: PaymentProvider | null;
    },
    input: {
      code: string;
      type: LedgerAccountType;
      normalBalance: LedgerNormalBalance;
      currency: string;
      merchantId?: string;
      provider?: PaymentProvider;
    },
  ): void {
    if (account.status !== LedgerAccountStatus.ACTIVE) {
      throw new InternalServerErrorException('Ledger account is not active');
    }
    if (
      account.code !== input.code ||
      account.type !== input.type ||
      account.normalBalance !== input.normalBalance ||
      account.currency !== input.currency ||
      account.merchantId !== (input.merchantId ?? null) ||
      account.provider !== (input.provider ?? null)
    ) {
      throw new InternalServerErrorException('Ledger account mapping is inconsistent');
    }
  }

  private assertBalanced(entries: PostingEntry[]): void {
    if (entries.length < 2 || entries.some((entry) => entry.amountTambala <= 0n)) {
      throw new InternalServerErrorException('Ledger entries must have positive amounts');
    }

    const debitTotal = entries
      .filter((entry) => entry.direction === LedgerEntryDirection.DEBIT)
      .reduce((total, entry) => total + entry.amountTambala, 0n);
    const creditTotal = entries
      .filter((entry) => entry.direction === LedgerEntryDirection.CREDIT)
      .reduce((total, entry) => total + entry.amountTambala, 0n);

    if (debitTotal !== creditTotal) {
      throw new InternalServerErrorException('Ledger transaction is not balanced');
    }
  }
}
