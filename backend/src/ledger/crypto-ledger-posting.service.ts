import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import type { Prisma as PrismaTypes } from '../generated/prisma/client.js';
import {
  LedgerAccountStatus,
  LedgerAccountType,
  LedgerEntryDirection,
  LedgerNormalBalance,
  LedgerTransactionStatus,
  PaymentProvider,
} from '../generated/prisma/enums.js';

interface SuccessfulCryptoPaymentPosting {
  paymentId: string; // The shared lifecycle transaction ID; crypto financial details remain asset-denominated.
  publicReference: string;
  merchantId: string;
  provider: PaymentProvider;
  asset: string;
  network: string | null;
  actuallyPaidAmount: PrismaTypes.Decimal | string;
  feeBps: number;
}

interface CryptoPostingEntry {
  accountId: string;
  direction: LedgerEntryDirection;
  amount: PrismaTypes.Decimal;
}

@Injectable()
export class CryptoLedgerPostingService {
  private readonly logger = new Logger(CryptoLedgerPostingService.name);

  async postSuccessfulCryptoPayment(
    tx: PrismaTypes.TransactionClient,
    payment: SuccessfulCryptoPaymentPosting,
  ) {
    const actuallyPaid = new Prisma.Decimal(payment.actuallyPaidAmount);

    if (actuallyPaid.lte(0)) {
      throw new InternalServerErrorException(
        'Cannot post a crypto payment with a non-positive actually_paid amount.',
      );
    }
    if (payment.feeBps < 0 || payment.feeBps >= 10_000) {
      throw new InternalServerErrorException('feeBps must be in [0, 10000).');
    }

    const feeAmount = actuallyPaid
      .mul(payment.feeBps)
      .div(10_000)
      .toDecimalPlaces(18);
    const merchantNetAmount = actuallyPaid.sub(feeAmount);

    if (merchantNetAmount.lte(0)) {
      throw new InternalServerErrorException(
        'Computed merchant net crypto amount is non-positive.',
      );
    }

    const existing = await tx.cryptoLedgerTransaction.findUnique({
      where: {
        sourceType_sourceId_postingPurpose: {
          sourceType: 'CRYPTO_PAYMENT',
          sourceId: payment.paymentId,
          postingPurpose: 'SUCCESS',
        },
      },
      include: { entries: true },
    });
    if (existing) {
      if (existing.status !== LedgerTransactionStatus.POSTED) {
        throw new InternalServerErrorException(
          'Existing crypto payment ledger posting is not posted',
        );
      }
      return { ledgerTransaction: existing, feeAmount, merchantNetAmount };
    }

    const { asset, network } = payment;

    const providerClearingAccount = await this.ensureAccount(tx, {
      key: `crypto-provider-clearing:${payment.provider}:${asset}:${network ?? 'NONE'}`,
      code: 'PROVIDER_CRYPTO_CLEARING',
      name: `${payment.provider} clearing — ${asset}${network ? ` (${network})` : ''}`,
      type: LedgerAccountType.ASSET,
      normalBalance: LedgerNormalBalance.DEBIT,
      asset,
      network,
      provider: payment.provider,
    });

    const merchantAccount = await this.ensureAccount(tx, {
      key: `crypto-merchant-balance:${payment.merchantId}:${asset}:${network ?? 'NONE'}`,
      code: 'MERCHANT_CRYPTO_BALANCE',
      name: `Merchant crypto balance ${payment.merchantId} — ${asset}${network ? ` (${network})` : ''}`,
      type: LedgerAccountType.LIABILITY,
      normalBalance: LedgerNormalBalance.CREDIT,
      asset,
      network,
      merchantId: payment.merchantId,
    });

    const entries: CryptoPostingEntry[] = [
      {
        accountId: providerClearingAccount.id,
        direction: LedgerEntryDirection.DEBIT,
        amount: actuallyPaid,
      },
      {
        accountId: merchantAccount.id,
        direction: LedgerEntryDirection.CREDIT,
        amount: merchantNetAmount,
      },
    ];

    if (feeAmount.gt(0)) {
      const feeAccount = await this.ensureAccount(tx, {
        key: `crypto-platform-fee-revenue:${asset}:${network ?? 'NONE'}`,
        code: 'PLATFORM_CRYPTO_FEE_REVENUE',
        name: `Platform crypto fee revenue — ${asset}${network ? ` (${network})` : ''}`,
        type: LedgerAccountType.REVENUE,
        normalBalance: LedgerNormalBalance.CREDIT,
        asset,
        network,
      });
      entries.push({
        accountId: feeAccount.id,
        direction: LedgerEntryDirection.CREDIT,
        amount: feeAmount,
      });
    }

    const ledgerTransaction = await this.postEntries(tx, {
      sourceType: 'CRYPTO_PAYMENT',
      sourceId: payment.paymentId,
      postingPurpose: 'SUCCESS',
      description: `Successful crypto payment ${payment.publicReference} (${asset}${network ? ` ${network}` : ''})`,
      provenance: 'CALLBACK',
      entries,
    });
    return { ledgerTransaction, feeAmount, merchantNetAmount };
  }

  private async postEntries(
    tx: PrismaTypes.TransactionClient,
    input: {
      sourceType: string;
      sourceId: string;
      postingPurpose: string;
      description: string;
      provenance: string;
      entries: CryptoPostingEntry[];
    },
  ) {
    this.assertBalanced(input.entries);

    const ledgerTransaction = await tx.cryptoLedgerTransaction.create({
      data: {
        reference: `cled_${randomUUID().replaceAll('-', '')}`,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        postingPurpose: input.postingPurpose,
        status: LedgerTransactionStatus.PENDING,
        description: input.description,
        provenance: input.provenance,
      },
    });

    await tx.cryptoLedgerEntry.createMany({
      data: input.entries.map((entry) => ({
        cryptoLedgerTransactionId: ledgerTransaction.id,
        accountId: entry.accountId,
        direction: entry.direction,
        amount: entry.amount,
      })),
    });

    for (const entry of input.entries) {
      await tx.cryptoLedgerAccountBalance.upsert({
        where: { accountId: entry.accountId },
        create: {
          accountId: entry.accountId,
          debitTotal:
            entry.direction === LedgerEntryDirection.DEBIT ? entry.amount : 0,
          creditTotal:
            entry.direction === LedgerEntryDirection.CREDIT ? entry.amount : 0,
        },
        update: {
          debitTotal: {
            increment:
              entry.direction === LedgerEntryDirection.DEBIT ? entry.amount : 0,
          },
          creditTotal: {
            increment:
              entry.direction === LedgerEntryDirection.CREDIT
                ? entry.amount
                : 0,
          },
        },
      });
    }

    return tx.cryptoLedgerTransaction.update({
      where: { id: ledgerTransaction.id },
      data: { status: LedgerTransactionStatus.POSTED, postedAt: new Date() },
      include: { entries: true },
    });
  }

  private async ensureAccount(
    tx: PrismaTypes.TransactionClient,
    input: {
      key: string;
      code: string;
      name: string;
      type: LedgerAccountType;
      normalBalance: LedgerNormalBalance;
      asset: string;
      network: string | null;
      merchantId?: string;
      provider?: PaymentProvider;
    },
  ) {
    const account = await tx.cryptoLedgerAccount.upsert({
      where: { key: input.key },
      create: {
        key: input.key,
        code: input.code,
        name: input.name,
        type: input.type,
        normalBalance: input.normalBalance,
        asset: input.asset,
        network: input.network,
        merchantId: input.merchantId ?? null,
        provider: input.provider ?? null,
      },
      update: {},
    });

    if (account.status !== LedgerAccountStatus.ACTIVE) {
      throw new InternalServerErrorException(
        `Crypto ledger account ${input.key} is not active.`,
      );
    }
    if (
      account.code !== input.code ||
      account.type !== input.type ||
      account.normalBalance !== input.normalBalance ||
      account.asset !== input.asset ||
      account.network !== input.network
    ) {
      throw new InternalServerErrorException(
        `Crypto ledger account mapping for ${input.key} is inconsistent.`,
      );
    }

    return account;
  }

  private assertBalanced(entries: CryptoPostingEntry[]): void {
    if (entries.length < 2 || entries.some((e) => e.amount.lte(0))) {
      throw new InternalServerErrorException(
        'Crypto ledger entries must have positive amounts.',
      );
    }
    const debitTotal = entries
      .filter((e) => e.direction === LedgerEntryDirection.DEBIT)
      .reduce((sum, e) => sum.add(e.amount), new Prisma.Decimal(0));
    const creditTotal = entries
      .filter((e) => e.direction === LedgerEntryDirection.CREDIT)
      .reduce((sum, e) => sum.add(e.amount), new Prisma.Decimal(0));

    if (!debitTotal.equals(creditTotal)) {
      throw new InternalServerErrorException(
        'Crypto ledger transaction is not balanced.',
      );
    }
  }
}
