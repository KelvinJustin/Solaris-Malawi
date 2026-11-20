-- CreateEnum
CREATE TYPE "SettlementImportStatus" AS ENUM ('IMPORTED', 'VALIDATION_FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "SettlementBatchStatus" AS ENUM ('IMPORTED', 'VALIDATED', 'RECONCILING', 'PARTIALLY_RECONCILED', 'RECONCILED', 'APPROVED', 'POSTED', 'DISCREPANCY', 'REJECTED');

-- CreateEnum
CREATE TYPE "SettlementItemKind" AS ENUM ('PAYMENT', 'PROVIDER_FEE', 'UNSUPPORTED', 'INVALID');

-- CreateEnum
CREATE TYPE "SettlementItemMatchStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHED', 'AMBIGUOUS', 'DUPLICATE', 'AMOUNT_MISMATCH', 'CURRENCY_MISMATCH', 'UNSUPPORTED', 'INVALID', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "BankStatementImportStatus" AS ENUM ('IMPORTED', 'VALIDATION_FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "BankStatementLineStatus" AS ENUM ('VALID', 'VALIDATION_FAILED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "SettlementAllocationStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateEnum
CREATE TYPE "SettlementAuditEventType" AS ENUM ('PROVIDER_IMPORT_CREATED', 'BANK_IMPORT_CREATED', 'ITEM_MATCHED', 'ITEM_UNMATCHED', 'BANK_ALLOCATION_CREATED', 'BANK_ALLOCATION_REVERSED', 'BATCH_APPROVED', 'BATCH_POSTED');

-- AlterEnum
ALTER TYPE "LedgerTransactionType" ADD VALUE 'PROVIDER_SETTLEMENT';

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_settlement_imports" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountReference" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceFileChecksum" TEXT NOT NULL,
    "sourceObjectKey" TEXT NOT NULL,
    "formatIdentifier" TEXT NOT NULL,
    "status" "SettlementImportStatus" NOT NULL DEFAULT 'IMPORTED',
    "importedById" UUID NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validationErrors" JSONB,

    CONSTRAINT "provider_settlement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_settlement_batches" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerAccountReference" TEXT NOT NULL,
    "providerBatchReference" TEXT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "reportPeriodStart" TIMESTAMP(3),
    "reportPeriodEnd" TIMESTAMP(3),
    "providerClosedAt" TIMESTAMP(3),
    "grossAmountTambala" BIGINT NOT NULL,
    "providerFeeAmountTambala" BIGINT NOT NULL,
    "expectedNetAmountTambala" BIGINT NOT NULL,
    "status" "SettlementBatchStatus" NOT NULL DEFAULT 'IMPORTED',
    "validationErrors" JSONB,
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "postedAt" TIMESTAMP(3),
    "ledgerTransactionId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_settlement_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_settlement_items" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "sourceRowIdentity" TEXT NOT NULL,
    "providerRecordReference" TEXT,
    "providerPaymentReference" TEXT,
    "recordKind" "SettlementItemKind" NOT NULL,
    "reportedStatus" TEXT,
    "settlementConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "grossAmountTambala" BIGINT,
    "providerFeeAmountTambala" BIGINT,
    "currency" VARCHAR(3),
    "matchingStatus" "SettlementItemMatchStatus" NOT NULL DEFAULT 'PENDING',
    "matchingMethod" TEXT,
    "paymentId" UUID,
    "rawRecord" JSONB NOT NULL,
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_settlement_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_imports" (
    "id" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceFileChecksum" TEXT NOT NULL,
    "sourceObjectKey" TEXT NOT NULL,
    "formatIdentifier" TEXT NOT NULL,
    "statementPeriodStart" TIMESTAMP(3),
    "statementPeriodEnd" TIMESTAMP(3),
    "status" "BankStatementImportStatus" NOT NULL DEFAULT 'IMPORTED',
    "importedById" UUID NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validationErrors" JSONB,

    CONSTRAINT "bank_statement_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "bankAccountId" UUID NOT NULL,
    "sourceRowIdentity" TEXT NOT NULL,
    "bankReference" TEXT,
    "description" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "valueDate" TIMESTAMP(3),
    "creditAmountTambala" BIGINT NOT NULL DEFAULT 0,
    "debitAmountTambala" BIGINT NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL,
    "status" "BankStatementLineStatus" NOT NULL DEFAULT 'VALID',
    "duplicateOfBankStatementLineId" UUID,
    "rawRecord" JSONB NOT NULL,
    "validationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_bank_allocations" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "bankStatementLineId" UUID NOT NULL,
    "amountTambala" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SettlementAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "allocatedById" UUID NOT NULL,
    "reversedById" UUID,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_bank_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_audit_events" (
    "id" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" "SettlementAuditEventType" NOT NULL,
    "actorId" UUID,
    "correlationId" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlement_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_reference_key" ON "bank_accounts"("reference");

-- CreateIndex
CREATE INDEX "provider_settlement_imports_provider_importedAt_idx" ON "provider_settlement_imports"("provider", "importedAt");

-- CreateIndex
CREATE INDEX "provider_settlement_imports_status_importedAt_idx" ON "provider_settlement_imports"("status", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_settlement_imports_provider_providerAccountReferen_key" ON "provider_settlement_imports"("provider", "providerAccountReference", "sourceFileChecksum");

-- CreateIndex
CREATE UNIQUE INDEX "provider_settlement_batches_ledgerTransactionId_key" ON "provider_settlement_batches"("ledgerTransactionId");

-- CreateIndex
CREATE INDEX "provider_settlement_batches_status_createdAt_idx" ON "provider_settlement_batches"("status", "createdAt");

-- CreateIndex
CREATE INDEX "provider_settlement_batches_provider_providerClosedAt_idx" ON "provider_settlement_batches"("provider", "providerClosedAt");

-- CreateIndex
CREATE UNIQUE INDEX "provider_settlement_batches_provider_providerAccountReferen_key" ON "provider_settlement_batches"("provider", "providerAccountReference", "currency", "providerBatchReference");

-- CreateIndex
CREATE INDEX "provider_settlement_items_providerPaymentReference_matching_idx" ON "provider_settlement_items"("providerPaymentReference", "matchingStatus");

-- CreateIndex
CREATE INDEX "provider_settlement_items_paymentId_matchingStatus_idx" ON "provider_settlement_items"("paymentId", "matchingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "provider_settlement_items_batchId_sourceRowIdentity_key" ON "provider_settlement_items"("batchId", "sourceRowIdentity");

-- CreateIndex
CREATE INDEX "bank_statement_imports_status_importedAt_idx" ON "bank_statement_imports"("status", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_imports_bankAccountId_sourceFileChecksum_key" ON "bank_statement_imports"("bankAccountId", "sourceFileChecksum");

-- CreateIndex
CREATE INDEX "bank_statement_lines_bankAccountId_bankReference_idx" ON "bank_statement_lines"("bankAccountId", "bankReference");

-- CreateIndex
CREATE INDEX "bank_statement_lines_status_transactionDate_idx" ON "bank_statement_lines"("status", "transactionDate");

-- CreateIndex
CREATE UNIQUE INDEX "bank_statement_lines_importId_sourceRowIdentity_key" ON "bank_statement_lines"("importId", "sourceRowIdentity");

-- CreateIndex
CREATE UNIQUE INDEX "settlement_bank_allocations_idempotencyKey_key" ON "settlement_bank_allocations"("idempotencyKey");

-- CreateIndex
CREATE INDEX "settlement_bank_allocations_batchId_status_idx" ON "settlement_bank_allocations"("batchId", "status");

-- CreateIndex
CREATE INDEX "settlement_bank_allocations_bankStatementLineId_status_idx" ON "settlement_bank_allocations"("bankStatementLineId", "status");

-- CreateIndex
CREATE INDEX "settlement_audit_events_entityType_entityId_createdAt_idx" ON "settlement_audit_events"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "settlement_audit_events_actorId_createdAt_idx" ON "settlement_audit_events"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "provider_settlement_imports" ADD CONSTRAINT "provider_settlement_imports_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_settlement_batches" ADD CONSTRAINT "provider_settlement_batches_importId_fkey" FOREIGN KEY ("importId") REFERENCES "provider_settlement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_settlement_batches" ADD CONSTRAINT "provider_settlement_batches_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_settlement_batches" ADD CONSTRAINT "provider_settlement_batches_ledgerTransactionId_fkey" FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_settlement_items" ADD CONSTRAINT "provider_settlement_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "provider_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_settlement_items" ADD CONSTRAINT "provider_settlement_items_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_imports" ADD CONSTRAINT "bank_statement_imports_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_importId_fkey" FOREIGN KEY ("importId") REFERENCES "bank_statement_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_duplicateOfBankStatementLineId_fkey" FOREIGN KEY ("duplicateOfBankStatementLineId") REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_bank_allocations" ADD CONSTRAINT "settlement_bank_allocations_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "provider_settlement_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_bank_allocations" ADD CONSTRAINT "settlement_bank_allocations_bankStatementLineId_fkey" FOREIGN KEY ("bankStatementLineId") REFERENCES "bank_statement_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_bank_allocations" ADD CONSTRAINT "settlement_bank_allocations_allocatedById_fkey" FOREIGN KEY ("allocatedById") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_bank_allocations" ADD CONSTRAINT "settlement_bank_allocations_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_audit_events" ADD CONSTRAINT "settlement_audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_accounts" DROP CONSTRAINT "ledger_accounts_owner_shape";
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_owner_shape" CHECK (
    ("code" = 'MERCHANT_PENDING' AND "merchantId" IS NOT NULL AND "provider" IS NULL)
    OR ("code" = 'PROVIDER_CLEARING' AND "merchantId" IS NULL AND "provider" IS NOT NULL)
    OR ("code" = 'PLATFORM_FEE_REVENUE' AND "merchantId" IS NULL AND "provider" IS NULL)
    OR ("code" = 'PLATFORM_BANK_CASH' AND "merchantId" IS NULL AND "provider" IS NULL)
    OR ("code" = 'PROVIDER_PROCESSING_EXPENSE' AND "merchantId" IS NULL AND "provider" IS NOT NULL)
);

ALTER TABLE "provider_settlement_imports"
  ADD CONSTRAINT "provider_settlement_imports_checksum_valid"
  CHECK ("sourceFileChecksum" ~ '^[A-Fa-f0-9]{64}$');
ALTER TABLE "provider_settlement_batches"
  ADD CONSTRAINT "provider_settlement_batches_amounts_valid"
  CHECK (
    "grossAmountTambala" >= 0
    AND "providerFeeAmountTambala" >= 0
    AND "expectedNetAmountTambala" >= 0
  ),
  ADD CONSTRAINT "provider_settlement_batches_period_valid"
  CHECK (
    "reportPeriodStart" IS NULL
    OR "reportPeriodEnd" IS NULL
    OR "reportPeriodStart" <= "reportPeriodEnd"
  );
ALTER TABLE "provider_settlement_items"
  ADD CONSTRAINT "provider_settlement_items_amounts_nonnegative"
  CHECK (
    ("grossAmountTambala" IS NULL OR "grossAmountTambala" >= 0)
    AND ("providerFeeAmountTambala" IS NULL OR "providerFeeAmountTambala" >= 0)
  );
ALTER TABLE "bank_statement_imports"
  ADD CONSTRAINT "bank_statement_imports_checksum_valid"
  CHECK ("sourceFileChecksum" ~ '^[A-Fa-f0-9]{64}$');
ALTER TABLE "bank_statement_lines"
  ADD CONSTRAINT "bank_statement_lines_one_direction"
  CHECK (
    "creditAmountTambala" >= 0
    AND "debitAmountTambala" >= 0
    AND (
      ("creditAmountTambala" > 0 AND "debitAmountTambala" = 0)
      OR ("debitAmountTambala" > 0 AND "creditAmountTambala" = 0)
      OR ("status" = 'VALIDATION_FAILED' AND "creditAmountTambala" = 0 AND "debitAmountTambala" = 0)
    )
  );
ALTER TABLE "settlement_bank_allocations"
  ADD CONSTRAINT "settlement_bank_allocations_amount_positive"
  CHECK ("amountTambala" > 0),
  ADD CONSTRAINT "settlement_bank_allocations_reversal_shape"
  CHECK (
    ("status" = 'ACTIVE' AND "reversedById" IS NULL AND "reversedAt" IS NULL AND "reversalReason" IS NULL)
    OR ("status" = 'REVERSED' AND "reversedById" IS NOT NULL AND "reversedAt" IS NOT NULL AND length(trim("reversalReason")) > 0)
  );

CREATE FUNCTION prevent_posted_settlement_batch_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted provider settlement batches are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "provider_settlement_batches_immutable_after_posting"
  BEFORE UPDATE OR DELETE ON "provider_settlement_batches"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_settlement_batch_mutation();

CREATE FUNCTION prevent_posted_settlement_child_mutation() RETURNS trigger AS $$
DECLARE
  settlement_batch_id UUID;
  batch_status "SettlementBatchStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    settlement_batch_id := OLD."batchId";
  ELSE
    settlement_batch_id := NEW."batchId";
  END IF;
  SELECT "status" INTO batch_status
  FROM "provider_settlement_batches"
  WHERE "id" = settlement_batch_id;
  IF batch_status = 'POSTED' THEN
    RAISE EXCEPTION 'Posted provider settlement evidence is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "provider_settlement_items_immutable_after_posting"
  BEFORE UPDATE OR DELETE ON "provider_settlement_items"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_settlement_child_mutation();
CREATE TRIGGER "settlement_allocations_immutable_after_posting"
  BEFORE UPDATE OR DELETE ON "settlement_bank_allocations"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_settlement_child_mutation();

CREATE FUNCTION prevent_settlement_import_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Imported settlement evidence is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "provider_settlement_imports_append_only"
  BEFORE UPDATE OR DELETE ON "provider_settlement_imports"
  FOR EACH ROW EXECUTE FUNCTION prevent_settlement_import_mutation();
CREATE TRIGGER "bank_statement_imports_append_only"
  BEFORE UPDATE OR DELETE ON "bank_statement_imports"
  FOR EACH ROW EXECUTE FUNCTION prevent_settlement_import_mutation();

CREATE FUNCTION prevent_bank_statement_line_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Imported bank statement lines are immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "bank_statement_lines_append_only"
  BEFORE UPDATE OR DELETE ON "bank_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION prevent_bank_statement_line_mutation();

CREATE FUNCTION prevent_settlement_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Settlement audit events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "settlement_audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "settlement_audit_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_settlement_audit_mutation();
