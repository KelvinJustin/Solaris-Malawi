import type { Prisma, PaymentProvider } from '../generated/prisma/client.js';

export interface NormalizedProviderSettlementItem {
  sourceRowIdentity: string;
  providerRecordReference?: string;
  providerPaymentReference?: string;
  recordKind: 'PAYMENT' | 'PROVIDER_FEE' | 'UNSUPPORTED' | 'INVALID';
  reportedStatus?: string;
  settlementConfirmed?: boolean;
  grossAmountTambala?: bigint;
  providerFeeAmountTambala?: bigint;
  currency?: string;
  rawRecord: Prisma.InputJsonValue;
  validationErrors?: Prisma.InputJsonValue;
}

export interface NormalizedProviderSettlementReport {
  provider: PaymentProvider;
  providerAccountReference: string;
  sourceFileName: string;
  sourceFileChecksum: string;
  sourceObjectKey: string;
  formatIdentifier: string;
  providerBatchReference: string;
  currency: string;
  reportPeriodStart?: Date;
  reportPeriodEnd?: Date;
  providerClosedAt?: Date;
  grossAmountTambala: bigint;
  providerFeeAmountTambala: bigint;
  expectedNetAmountTambala: bigint;
  items: NormalizedProviderSettlementItem[];
}

export interface NormalizedBankStatementLine {
  sourceRowIdentity: string;
  bankReference?: string;
  description?: string;
  transactionDate: Date;
  valueDate?: Date;
  creditAmountTambala: bigint;
  debitAmountTambala: bigint;
  currency: string;
  rawRecord: Prisma.InputJsonValue;
  validationErrors?: Prisma.InputJsonValue;
}

export interface NormalizedBankStatement {
  bankAccountId: string;
  sourceFileName: string;
  sourceFileChecksum: string;
  sourceObjectKey: string;
  formatIdentifier: string;
  statementPeriodStart?: Date;
  statementPeriodEnd?: Date;
  lines: NormalizedBankStatementLine[];
}
