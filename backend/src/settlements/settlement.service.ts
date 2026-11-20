import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentStatus,
  SettlementAllocationStatus,
  SettlementAuditEventType,
  AdminRole,
  SettlementBatchStatus,
  SettlementImportStatus,
  SettlementItemKind,
  SettlementItemMatchStatus,
  BankStatementImportStatus,
  BankStatementLineStatus,
} from '../generated/prisma/enums.js';
import { DatabaseService } from '../database/database.service.js';
import { LedgerPostingService } from '../ledger/ledger-posting.service.js';
import type {
  NormalizedBankStatement,
  NormalizedProviderSettlementReport,
} from './settlement-normalized.types.js';

@Injectable()
export class SettlementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly ledgerPosting: LedgerPostingService,
  ) {}

  async importProviderSettlement(
    input: NormalizedProviderSettlementReport,
    actorId: string,
  ) {
    await this.assertAdminRole(actorId, AdminRole.OPERATIONS);
    if (!/^[A-Fa-f0-9]{64}$/.test(input.sourceFileChecksum)) {
      throw new BadRequestException('Provider source checksum must be SHA-256');
    }
    if (
      input.grossAmountTambala < 0n ||
      input.providerFeeAmountTambala < 0n ||
      input.expectedNetAmountTambala < 0n ||
      input.grossAmountTambala !==
        input.providerFeeAmountTambala + input.expectedNetAmountTambala
    ) {
      throw new BadRequestException('Provider settlement totals are inconsistent');
    }

    return this.database.$transaction(async (tx) => {
      const existing = await tx.providerSettlementImport.findUnique({
        where: {
          provider_providerAccountReference_sourceFileChecksum: {
            provider: input.provider,
            providerAccountReference: input.providerAccountReference,
            sourceFileChecksum: input.sourceFileChecksum,
          },
        },
      });
      if (existing) {
        const batch = await tx.providerSettlementBatch.findUnique({
          where: {
            provider_providerAccountReference_currency_providerBatchReference: {
              provider: input.provider,
              providerAccountReference: input.providerAccountReference,
              currency: input.currency,
              providerBatchReference: input.providerBatchReference,
            },
          },
        });
        if (!batch) {
          throw new ConflictException(
            'Duplicate source import exists without its settlement batch',
          );
        }
        return { import: existing, batch };
      }

      const settlementImport = await tx.providerSettlementImport.create({
        data: {
          provider: input.provider,
          providerAccountReference: input.providerAccountReference,
          sourceFileName: input.sourceFileName,
          sourceFileChecksum: input.sourceFileChecksum,
          sourceObjectKey: input.sourceObjectKey,
          formatIdentifier: input.formatIdentifier,
          status: SettlementImportStatus.IMPORTED,
          importedById: actorId,
        },
      });
      await tx.settlementAuditEvent.create({
        data: {
          entityType: 'PROVIDER_SETTLEMENT_IMPORT',
          entityId: settlementImport.id,
          eventType: SettlementAuditEventType.PROVIDER_IMPORT_CREATED,
          actorId,
          metadata: {
            provider: input.provider,
            sourceFileChecksum: input.sourceFileChecksum,
            formatIdentifier: input.formatIdentifier,
          },
        },
      });

      const batch = await tx.providerSettlementBatch.upsert({
        where: {
          provider_providerAccountReference_currency_providerBatchReference: {
            provider: input.provider,
            providerAccountReference: input.providerAccountReference,
            currency: input.currency,
            providerBatchReference: input.providerBatchReference,
          },
        },
        create: {
          importId: settlementImport.id,
          provider: input.provider,
          providerAccountReference: input.providerAccountReference,
          providerBatchReference: input.providerBatchReference,
          currency: input.currency,
          reportPeriodStart: input.reportPeriodStart,
          reportPeriodEnd: input.reportPeriodEnd,
          providerClosedAt: input.providerClosedAt,
          grossAmountTambala: input.grossAmountTambala,
          providerFeeAmountTambala: input.providerFeeAmountTambala,
          expectedNetAmountTambala: input.expectedNetAmountTambala,
          status: SettlementBatchStatus.IMPORTED,
        },
        update: {},
      });

      for (const item of input.items) {
        await tx.providerSettlementItem.upsert({
          where: {
            batchId_sourceRowIdentity: {
              batchId: batch.id,
              sourceRowIdentity: item.sourceRowIdentity,
            },
          },
          create: {
            batchId: batch.id,
            sourceRowIdentity: item.sourceRowIdentity,
            providerRecordReference: item.providerRecordReference,
            providerPaymentReference: item.providerPaymentReference,
            recordKind: item.recordKind as SettlementItemKind,
            reportedStatus: item.reportedStatus,
            settlementConfirmed: item.settlementConfirmed ?? false,
            grossAmountTambala: item.grossAmountTambala,
            providerFeeAmountTambala: item.providerFeeAmountTambala,
            currency: item.currency,
            rawRecord: item.rawRecord,
            validationErrors: item.validationErrors,
          },
          update: {},
        });
      }
      return { import: settlementImport, batch };
    });
  }

  async importBankStatement(input: NormalizedBankStatement, actorId: string) {
    await this.assertAdminRole(actorId, AdminRole.OPERATIONS);
    if (!/^[A-Fa-f0-9]{64}$/.test(input.sourceFileChecksum)) {
      throw new BadRequestException('Bank source checksum must be SHA-256');
    }

    return this.database.$transaction(async (tx) => {
      const existing = await tx.bankStatementImport.findUnique({
        where: {
          bankAccountId_sourceFileChecksum: {
            bankAccountId: input.bankAccountId,
            sourceFileChecksum: input.sourceFileChecksum,
          },
        },
      });
      if (existing) return existing;

      const statementImport = await tx.bankStatementImport.create({
        data: {
          bankAccountId: input.bankAccountId,
          sourceFileName: input.sourceFileName,
          sourceFileChecksum: input.sourceFileChecksum,
          sourceObjectKey: input.sourceObjectKey,
          formatIdentifier: input.formatIdentifier,
          statementPeriodStart: input.statementPeriodStart,
          statementPeriodEnd: input.statementPeriodEnd,
          status: BankStatementImportStatus.IMPORTED,
          importedById: actorId,
        },
      });
      await tx.settlementAuditEvent.create({
        data: {
          entityType: 'BANK_STATEMENT_IMPORT',
          entityId: statementImport.id,
          eventType: SettlementAuditEventType.BANK_IMPORT_CREATED,
          actorId,
          metadata: {
            bankAccountId: input.bankAccountId,
            sourceFileChecksum: input.sourceFileChecksum,
            formatIdentifier: input.formatIdentifier,
          },
        },
      });

      for (const line of input.lines) {
        await tx.bankStatementLine.upsert({
          where: {
            importId_sourceRowIdentity: {
              importId: statementImport.id,
              sourceRowIdentity: line.sourceRowIdentity,
            },
          },
          create: {
            importId: statementImport.id,
            bankAccountId: input.bankAccountId,
            sourceRowIdentity: line.sourceRowIdentity,
            bankReference: line.bankReference,
            description: line.description,
            transactionDate: line.transactionDate,
            valueDate: line.valueDate,
            creditAmountTambala: line.creditAmountTambala,
            debitAmountTambala: line.debitAmountTambala,
            currency: line.currency,
            rawRecord: line.rawRecord,
            validationErrors: line.validationErrors,
            status:
              line.creditAmountTambala > 0n && line.debitAmountTambala === 0n
                ? BankStatementLineStatus.VALID
                : line.debitAmountTambala > 0n &&
                    line.creditAmountTambala === 0n
                  ? BankStatementLineStatus.VALID
                  : BankStatementLineStatus.VALIDATION_FAILED,
          },
          update: {},
        });
      }
      return statementImport;
    });
  }

  async reconcileBatch(batchId: string, actorId: string) {
    await this.assertAdminRole(actorId, AdminRole.OPERATIONS);
    return this.database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "provider_settlement_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`;
        const batch = await tx.providerSettlementBatch.findUnique({
          where: { id: batchId },
          include: { items: true },
        });
        if (!batch) throw new NotFoundException('Settlement batch not found');
        if (batch.status === SettlementBatchStatus.POSTED) {
          throw new ConflictException('Posted settlement batch is immutable');
        }

        let unresolved = false;
        for (const item of batch.items) {
          if (
            item.recordKind === SettlementItemKind.PROVIDER_FEE ||
            item.recordKind === SettlementItemKind.UNSUPPORTED ||
            item.recordKind === SettlementItemKind.INVALID
          ) {
            const status =
              item.recordKind === SettlementItemKind.PROVIDER_FEE
                ? SettlementItemMatchStatus.NOT_APPLICABLE
                : SettlementItemMatchStatus.UNSUPPORTED;
            await tx.providerSettlementItem.update({
              where: { id: item.id },
              data: { matchingStatus: status, matchingMethod: 'NORMALIZED_RECORD_KIND' },
            });
            continue;
          }
          if (
            !item.providerPaymentReference ||
            !item.currency ||
            item.grossAmountTambala === null ||
            item.grossAmountTambala <= 0n
          ) {
            unresolved = true;
            await tx.providerSettlementItem.update({
              where: { id: item.id },
              data: {
                matchingStatus: SettlementItemMatchStatus.INVALID,
                matchingMethod: 'EXACT_REFERENCE_VALIDATION',
              },
            });
            continue;
          }

          const matches = await tx.paymentTransaction.findMany({
            where: {
              provider: batch.provider,
              providerReference: item.providerPaymentReference,
            },
            select: { id: true, status: true, currency: true, amountTambala: true, merchantNetTambala: true },
          });
          if (matches.length === 0) {
            unresolved = true;
            await tx.providerSettlementItem.update({
              where: { id: item.id },
              data: { matchingStatus: SettlementItemMatchStatus.UNMATCHED, matchingMethod: 'EXACT_PROVIDER_REFERENCE' },
            });
          } else if (matches.length > 1) {
            unresolved = true;
            await tx.providerSettlementItem.update({
              where: { id: item.id },
              data: { matchingStatus: SettlementItemMatchStatus.AMBIGUOUS, matchingMethod: 'EXACT_PROVIDER_REFERENCE' },
            });
          } else {
            const payment = matches[0];
            let status: SettlementItemMatchStatus = SettlementItemMatchStatus.MATCHED;
            if (payment.status !== PaymentStatus.SUCCEEDED) {
              status = SettlementItemMatchStatus.UNMATCHED;
              unresolved = true;
            } else if (payment.currency !== item.currency) {
              status = SettlementItemMatchStatus.CURRENCY_MISMATCH;
              unresolved = true;
            } else if (BigInt(payment.amountTambala) !== item.grossAmountTambala) {
              status = SettlementItemMatchStatus.AMOUNT_MISMATCH;
              unresolved = true;
            }
            await tx.providerSettlementItem.update({
              where: { id: item.id },
              data: {
                matchingStatus: status,
                matchingMethod: 'EXACT_PROVIDER_REFERENCE',
                paymentId: status === SettlementItemMatchStatus.MATCHED ? payment.id : null,
              },
            });
          }
        }

        const allocations = await tx.settlementBankAllocation.aggregate({
          where: { batchId, status: SettlementAllocationStatus.ACTIVE },
          _sum: { amountTambala: true },
        });
        const allocated = allocations._sum.amountTambala ?? 0n;
        const status = unresolved
          ? SettlementBatchStatus.DISCREPANCY
          : allocated === 0n
            ? SettlementBatchStatus.VALIDATED
            : allocated === batch.expectedNetAmountTambala
              ? SettlementBatchStatus.RECONCILED
              : SettlementBatchStatus.PARTIALLY_RECONCILED;

        const updated = await tx.providerSettlementBatch.update({
          where: { id: batchId },
          data: {
            status,
            validationErrors: unresolved ? { unresolved: true } : undefined,
          },
        });
        await tx.settlementAuditEvent.create({
          data: {
            entityType: 'PROVIDER_SETTLEMENT_BATCH',
            entityId: batchId,
            eventType: SettlementAuditEventType.ITEM_MATCHED,
            actorId,
            metadata: { status, allocatedNetTambala: allocated.toString() },
          },
        });
        return updated;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async allocateBankCredit(
    batchId: string,
    bankStatementLineId: string,
    amountTambala: bigint,
    idempotencyKey: string,
    actorId: string,
  ) {
    await this.assertAdminRole(actorId, AdminRole.OPERATIONS);
    return this.database.$transaction(
      async (tx) => {
        const existing = await tx.settlementBankAllocation.findUnique({
          where: { idempotencyKey },
        });
        if (existing) return existing;

        await tx.$queryRaw`SELECT "id" FROM "provider_settlement_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT "id" FROM "bank_statement_lines" WHERE "id" = ${bankStatementLineId}::uuid FOR UPDATE`;

        const batch = await tx.providerSettlementBatch.findUnique({
          where: { id: batchId },
        });
        const line = await tx.bankStatementLine.findUnique({
          where: { id: bankStatementLineId },
          include: { bankAccount: true },
        });
        if (!batch) throw new NotFoundException('Settlement batch not found');
        if (!line) throw new NotFoundException('Bank statement line not found');
        if (batch.status === SettlementBatchStatus.POSTED) {
          throw new ConflictException('Posted settlement batch is immutable');
        }
        if (
          line.status !== BankStatementLineStatus.VALID ||
          line.creditAmountTambala <= 0n ||
          line.debitAmountTambala !== 0n
        ) {
          throw new BadRequestException('Only a valid bank credit line can be allocated');
        }
        if (line.currency !== batch.currency) {
          throw new BadRequestException('Bank and settlement currencies differ');
        }

        const [batchAllocated, lineAllocated] = await Promise.all([
          tx.settlementBankAllocation.aggregate({
            where: { batchId, status: SettlementAllocationStatus.ACTIVE },
            _sum: { amountTambala: true },
          }),
          tx.settlementBankAllocation.aggregate({
            where: { bankStatementLineId, status: SettlementAllocationStatus.ACTIVE },
            _sum: { amountTambala: true },
          }),
        ]);
        const batchRemaining =
          batch.expectedNetAmountTambala -
          (batchAllocated._sum.amountTambala ?? 0n);
        const lineRemaining =
          line.creditAmountTambala -
          (lineAllocated._sum.amountTambala ?? 0n);
        if (amountTambala <= 0n) {
          throw new BadRequestException('Allocation amount must be positive');
        }
        if (amountTambala > batchRemaining || amountTambala > lineRemaining) {
          throw new ConflictException('Allocation exceeds batch or bank credit remaining');
        }

        const allocation = await tx.settlementBankAllocation.create({
          data: {
            batchId,
            bankStatementLineId,
            amountTambala,
            idempotencyKey,
            allocatedById: actorId,
          },
        });
        await tx.settlementAuditEvent.create({
          data: {
            entityType: 'PROVIDER_SETTLEMENT_BATCH',
            entityId: batchId,
            eventType: SettlementAuditEventType.BANK_ALLOCATION_CREATED,
            actorId,
            metadata: { batchId, bankStatementLineId, amountTambala: amountTambala.toString() },
          },
        });

        const newBatchTotal =
          (batchAllocated._sum.amountTambala ?? 0n) + amountTambala;
        await tx.providerSettlementBatch.update({
          where: { id: batchId },
          data: {
            status:
              newBatchTotal === batch.expectedNetAmountTambala
                ? SettlementBatchStatus.RECONCILED
                : SettlementBatchStatus.PARTIALLY_RECONCILED,
          },
        });
        return allocation;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async approveBatch(batchId: string, actorId: string) {
    await this.assertAdminRole(actorId, AdminRole.SUPER_ADMIN);
    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "provider_settlement_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`;
      const batch = await tx.providerSettlementBatch.findUnique({
        where: { id: batchId },
        include: { items: true },
      });
      if (!batch) throw new NotFoundException('Settlement batch not found');
      if (batch.status !== SettlementBatchStatus.RECONCILED) {
        throw new ConflictException('Only a reconciled batch can be approved');
      }
      if (batch.items.some((item) => item.matchingStatus !== SettlementItemMatchStatus.MATCHED &&
        item.matchingStatus !== SettlementItemMatchStatus.NOT_APPLICABLE)) {
        throw new ConflictException('Settlement batch contains unresolved items');
      }

      const allocation = await tx.settlementBankAllocation.aggregate({
        where: { batchId, status: SettlementAllocationStatus.ACTIVE },
        _sum: { amountTambala: true },
      });
      if ((allocation._sum.amountTambala ?? 0n) !== batch.expectedNetAmountTambala) {
        throw new ConflictException('Bank allocation does not equal batch net');
      }
      const reconciliationActors = await tx.settlementAuditEvent.findMany({
        where: {
          entityType: 'PROVIDER_SETTLEMENT_BATCH',
          entityId: batchId,
          eventType: {
            in: [
              SettlementAuditEventType.ITEM_MATCHED,
              SettlementAuditEventType.ITEM_UNMATCHED,
              SettlementAuditEventType.BANK_ALLOCATION_CREATED,
            ],
          },
        },
        select: { actorId: true },
      });
      if (reconciliationActors.some((event) => event.actorId === actorId)) {
        throw new ForbiddenException(
          'An admin cannot approve settlement work they reconciled or allocated',
        );
      }

      const updated = await tx.providerSettlementBatch.update({
        where: { id: batchId },
        data: { status: SettlementBatchStatus.APPROVED, approvedAt: new Date(), approvedById: actorId },
      });
      await tx.settlementAuditEvent.create({
        data: {
          entityType: 'PROVIDER_SETTLEMENT_BATCH',
          entityId: batchId,
          eventType: SettlementAuditEventType.BATCH_APPROVED,
          actorId,
        },
      });
      return updated;
    });
  }

  async postBatch(batchId: string, actorId: string) {
    await this.assertAdminRole(actorId, AdminRole.SUPER_ADMIN);
    return this.database.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "provider_settlement_batches" WHERE "id" = ${batchId}::uuid FOR UPDATE`;
      const batch = await tx.providerSettlementBatch.findUnique({
        where: { id: batchId },
        include: {
          bankAllocations: {
            where: { status: SettlementAllocationStatus.ACTIVE },
            include: { bankStatementLine: { include: { bankAccount: true } } },
          },
        },
      });
      if (!batch) throw new NotFoundException('Settlement batch not found');
      if (batch.status === SettlementBatchStatus.POSTED) return batch;
      if (batch.status !== SettlementBatchStatus.APPROVED) {
        throw new ConflictException('Only an approved batch can be posted');
      }
      if (batch.approvedById === actorId) {
        throw new ForbiddenException(
          'An admin cannot post a settlement batch they approved',
        );
      }
      const reconciliationActorIds = await tx.settlementAuditEvent.findMany({
        where: {
          entityType: 'PROVIDER_SETTLEMENT_BATCH',
          entityId: batchId,
          eventType: {
            in: [
              SettlementAuditEventType.ITEM_MATCHED,
              SettlementAuditEventType.ITEM_UNMATCHED,
              SettlementAuditEventType.BANK_ALLOCATION_CREATED,
            ],
          },
        },
        select: { actorId: true },
      });
      if (reconciliationActorIds.some((event) => event.actorId === actorId)) {
        throw new ForbiddenException(
          'An admin cannot post settlement work they reconciled',
        );
      }

      const allocated = batch.bankAllocations.reduce(
        (total, allocation) => total + allocation.amountTambala,
        0n,
      );
      if (allocated !== batch.expectedNetAmountTambala) {
        throw new ConflictException('Approved batch is not fully allocated to bank credits');
      }

      const clearingAccount = await tx.ledgerAccount.findFirst({
        where: {
          code: 'PROVIDER_CLEARING',
          currency: batch.currency,
          provider: batch.provider,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!clearingAccount) {
        throw new ConflictException(
          'Provider clearing account is missing or inactive',
        );
      }
      await tx.$queryRaw`SELECT "id" FROM "ledger_accounts" WHERE "id" = ${clearingAccount.id}::uuid FOR UPDATE`;
      const [debits, credits] = await Promise.all([
        tx.ledgerEntry.aggregate({
          where: {
            accountId: clearingAccount.id,
            direction: 'DEBIT',
            ledgerTransaction: { status: 'POSTED' },
          },
          _sum: { amountTambala: true },
        }),
        tx.ledgerEntry.aggregate({
          where: {
            accountId: clearingAccount.id,
            direction: 'CREDIT',
            ledgerTransaction: { status: 'POSTED' },
          },
          _sum: { amountTambala: true },
        }),
      ]);
      const receivable =
        (debits._sum.amountTambala ?? 0n) -
        (credits._sum.amountTambala ?? 0n);
      if (batch.grossAmountTambala > receivable) {
        throw new ConflictException(
          'Settlement gross exceeds the provider clearing receivable',
        );
      }

      const receipts = batch.bankAllocations.map((allocation) => ({
        bankAccountId: allocation.bankStatementLine.bankAccountId,
        bankAccountName: allocation.bankStatementLine.bankAccount.name,
        amountTambala: allocation.amountTambala,
      }));
      const ledgerTransaction = await this.ledgerPosting.postProviderSettlement(tx, {
        batchId,
        batchReference: batch.providerBatchReference,
        provider: batch.provider,
        currency: batch.currency,
        grossAmountTambala: batch.grossAmountTambala,
        providerFeeAmountTambala: batch.providerFeeAmountTambala,
        expectedNetAmountTambala: batch.expectedNetAmountTambala,
        bankReceipts: receipts,
      });
      const updated = await tx.providerSettlementBatch.update({
        where: { id: batchId },
        data: {
          status: SettlementBatchStatus.POSTED,
          postedAt: new Date(),
          ledgerTransactionId: ledgerTransaction.id,
        },
      });
      await tx.settlementAuditEvent.create({
        data: {
          entityType: 'PROVIDER_SETTLEMENT_BATCH',
          entityId: batchId,
          eventType: SettlementAuditEventType.BATCH_POSTED,
          actorId,
          metadata: { ledgerTransactionId: ledgerTransaction.id },
        },
      });
      return updated;
    });
  }

  private async assertAdminRole(actorId: string, requiredRole: AdminRole): Promise<void> {
    const admin = await this.database.admin.findUnique({
      where: { id: actorId },
      select: { role: true, status: true },
    });
    if (!admin) {
      throw new NotFoundException('Admin actor not found');
    }
    if (admin.status !== 'ACTIVE') {
      throw new ForbiddenException('Admin actor is not active');
    }
    if (admin.role !== requiredRole) {
      throw new ForbiddenException(
        `Admin actor must have role ${requiredRole}`,
      );
    }
  }
}
