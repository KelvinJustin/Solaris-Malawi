import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '../database/database.service.js';
import { LedgerPostingService } from '../ledger/ledger-posting.service.js';
import { SettlementService } from './settlement.service.js';
import {
  AdminRole,
  AdminStatus,
  PaymentProvider,
  SettlementBatchStatus,
  LedgerTransactionStatus,
} from '../generated/prisma/enums.js';

describe('provider settlement PostgreSQL integration', () => {
  let database: DatabaseService;
  let settlement: SettlementService;
  let operationsAdminId: string;
  let approverAdminId: string;
  let posterAdminId: string;
  let originalDatabaseUrl: string | undefined;

  beforeAll(async () => {
    const testDatabaseUrl = process.env.LEDGER_TEST_DATABASE_URL;
    if (!testDatabaseUrl) throw new Error('LEDGER_TEST_DATABASE_URL is required');
    const databaseName = decodeURIComponent(new URL(testDatabaseUrl).pathname.slice(1));
    if (!/(^|[_-])test([_-]|$)/i.test(databaseName)) {
      throw new Error('LEDGER_TEST_DATABASE_URL must point to a dedicated test database');
    }
    originalDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = testDatabaseUrl;
    database = new DatabaseService();
    await database.$connect();
    settlement = new SettlementService(database, new LedgerPostingService());
    operationsAdminId = (await database.admin.create({
      data: {
        name: `Settlement Test ${randomUUID()}`,
        email: `settlement-${randomUUID()}@example.test`,
        passwordHash: 'integration-test',
        role: AdminRole.OPERATIONS,
        status: AdminStatus.ACTIVE,
      },
    })).id;
    approverAdminId = (await database.admin.create({
      data: {
        name: `Settlement Approver ${randomUUID()}`,
        email: `settlement-approver-${randomUUID()}@example.test`,
        passwordHash: 'integration-test',
        role: AdminRole.SUPER_ADMIN,
        status: AdminStatus.ACTIVE,
      },
    })).id;
    posterAdminId = (await database.admin.create({
      data: {
        name: `Settlement Poster ${randomUUID()}`,
        email: `settlement-poster-${randomUUID()}@example.test`,
        passwordHash: 'integration-test',
        role: AdminRole.SUPER_ADMIN,
        status: AdminStatus.ACTIVE,
      },
    })).id;
  });

  afterAll(async () => {
    await database?.$disconnect();
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it('deduplicates normalized provider imports and batch rows', async () => {
    const checksum = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    const report = await settlement.importProviderSettlement({
      provider: PaymentProvider.TEST,
      providerAccountReference: `test-account-${randomUUID()}`,
      sourceFileName: 'normalized.json',
      sourceFileChecksum: checksum,
      sourceObjectKey: `settlement-test/${randomUUID()}.json`,
      formatIdentifier: 'normalized-v1',
      providerBatchReference: `batch-${randomUUID()}`,
      currency: 'MWK',
      grossAmountTambala: 1000n,
      providerFeeAmountTambala: 100n,
      expectedNetAmountTambala: 900n,
      items: [],
    }, operationsAdminId);
    const duplicate = await settlement.importProviderSettlement({
      provider: PaymentProvider.TEST,
      providerAccountReference: report.batch.providerAccountReference,
      sourceFileName: 'normalized.json',
      sourceFileChecksum: checksum,
      sourceObjectKey: report.import.sourceObjectKey,
      formatIdentifier: 'normalized-v1',
      providerBatchReference: report.batch.providerBatchReference,
      currency: 'MWK',
      grossAmountTambala: 1000n,
      providerFeeAmountTambala: 100n,
      expectedNetAmountTambala: 900n,
      items: [],
    }, operationsAdminId);
    expect(duplicate.import.id).toBe(report.import.id);
  });

  it('enforces service-level role separation for imports and approvals', async () => {
    await expect(
      settlement.importProviderSettlement({
        provider: PaymentProvider.TEST,
        providerAccountReference: `wrong-role-${randomUUID()}`,
        sourceFileName: 'wrong-role.json',
        sourceFileChecksum: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
        sourceObjectKey: `settlement-test/${randomUUID()}.json`,
        formatIdentifier: 'normalized-v1',
        providerBatchReference: `wrong-role-${randomUUID()}`,
        currency: 'MWK',
        grossAmountTambala: 100n,
        providerFeeAmountTambala: 0n,
        expectedNetAmountTambala: 100n,
        items: [],
      }, approverAdminId),
    ).rejects.toThrow();

    await expect(
      settlement.approveBatch(randomUUID(), operationsAdminId),
    ).rejects.toThrow();
  });

  it('rejects concurrent over-allocation and posts one settlement ledger transaction', async () => {
    const bankAccount = await database.bankAccount.create({
      data: {
        reference: `bank-${randomUUID()}`,
        name: 'Integration bank',
        currency: 'MWK',
      },
    });
    const checksum = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    const statement = await settlement.importBankStatement({
      bankAccountId: bankAccount.id,
      sourceFileName: 'bank-normalized.json',
      sourceFileChecksum: checksum,
      sourceObjectKey: `bank-test/${randomUUID()}.json`,
      formatIdentifier: 'normalized-v1',
      lines: [{
        sourceRowIdentity: `row-${randomUUID()}`,
        transactionDate: new Date(),
        creditAmountTambala: 600n,
        debitAmountTambala: 0n,
        currency: 'MWK',
        rawRecord: { normalized: true },
      }],
    }, operationsAdminId);
    const line = await database.bankStatementLine.findFirstOrThrow({
      where: { importId: statement.id },
    });
    const reportChecksum = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    const providerImport = await settlement.importProviderSettlement({
      provider: PaymentProvider.TEST,
      providerAccountReference: `test-account-${randomUUID()}`,
      sourceFileName: 'provider-normalized.json',
      sourceFileChecksum: reportChecksum,
      sourceObjectKey: `settlement-test/${randomUUID()}.json`,
      formatIdentifier: 'normalized-v1',
      providerBatchReference: `batch-${randomUUID()}`,
      currency: 'MWK',
      grossAmountTambala: 700n,
      providerFeeAmountTambala: 100n,
      expectedNetAmountTambala: 600n,
      items: [],
    }, operationsAdminId);
    const batchId = providerImport.batch.id;
    const reconciled = await settlement.reconcileBatch(batchId, operationsAdminId);
    expect([
      SettlementBatchStatus.VALIDATED,
      SettlementBatchStatus.RECONCILING,
    ]).toContain(reconciled.status);

    const allocationResults = await Promise.allSettled([
      settlement.allocateBankCredit(batchId, line.id, 600n, `alloc-${randomUUID()}`, operationsAdminId),
      settlement.allocateBankCredit(batchId, line.id, 600n, `alloc-${randomUUID()}`, operationsAdminId),
    ]);
    expect(allocationResults.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(allocationResults.filter((result) => result.status === 'rejected')).toHaveLength(1);

    await settlement.approveBatch(batchId, approverAdminId);
    await expect(
      settlement.postBatch(batchId, approverAdminId),
    ).rejects.toThrow();
    const posted = await settlement.postBatch(batchId, posterAdminId);
    expect(posted.status).toBe(SettlementBatchStatus.POSTED);
    expect(posted.ledgerTransactionId).not.toBeNull();

    const ledger = await database.ledgerTransaction.findUniqueOrThrow({
      where: { id: posted.ledgerTransactionId! },
      include: { entries: true },
    });
    expect(ledger.status).toBe(LedgerTransactionStatus.POSTED);
    expect(ledger.entries.reduce((debits, entry) =>
      debits + (entry.direction === 'DEBIT' ? entry.amountTambala : 0n), 0n
    )).toBe(ledger.entries.reduce((credits, entry) =>
      credits + (entry.direction === 'CREDIT' ? entry.amountTambala : 0n), 0n
    ));
    expect(ledger.entries.every((entry) => entry.amountTambala > 0n)).toBe(true);
  });

  it('prevents allocating more than a bank credit remaining', async () => {
    const bankAccount = await database.bankAccount.create({
      data: { reference: `bank-${randomUUID()}`, name: 'Small bank', currency: 'MWK' },
    });
    const checksum = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    const statement = await settlement.importBankStatement({
      bankAccountId: bankAccount.id,
      sourceFileName: 'bank.json',
      sourceFileChecksum: checksum,
      sourceObjectKey: `bank/${randomUUID()}`,
      formatIdentifier: 'normalized-v1',
      lines: [{
        sourceRowIdentity: `row-${randomUUID()}`,
        transactionDate: new Date(),
        creditAmountTambala: 100n,
        debitAmountTambala: 0n,
        currency: 'MWK',
        rawRecord: {},
      }],
    }, operationsAdminId);
    const line = await database.bankStatementLine.findFirstOrThrow({ where: { importId: statement.id } });
    const checksum2 = randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64);
    const report = await settlement.importProviderSettlement({
      provider: PaymentProvider.TEST,
      providerAccountReference: `account-${randomUUID()}`,
      sourceFileName: 'provider.json',
      sourceFileChecksum: checksum2,
      sourceObjectKey: `provider/${randomUUID()}`,
      formatIdentifier: 'normalized-v1',
      providerBatchReference: `batch-${randomUUID()}`,
      currency: 'MWK',
      grossAmountTambala: 200n,
      providerFeeAmountTambala: 0n,
      expectedNetAmountTambala: 200n,
      items: [],
    }, operationsAdminId);
    await expect(
      settlement.allocateBankCredit(report.batch.id, line.id, 101n, `alloc-${randomUUID()}`, operationsAdminId),
    ).rejects.toThrow();
  });
});
