CREATE TYPE "FeeType" AS ENUM ('ZERO', 'PERCENTAGE', 'FIXED', 'HYBRID');
CREATE TYPE "FeePolicyAuditAction" AS ENUM ('CREATED', 'ACTIVATED', 'DEACTIVATED');
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "LedgerNormalBalance" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "LedgerAccountStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
CREATE TYPE "LedgerTransactionType" AS ENUM ('PAYMENT_CAPTURE');
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('PENDING', 'POSTED');
CREATE TYPE "LedgerEntryDirection" AS ENUM ('DEBIT', 'CREDIT');

ALTER TABLE "payment_transactions"
  ADD COLUMN "feeTambala" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "merchantNetTambala" BIGINT,
  ADD COLUMN "feeType" "FeeType" NOT NULL DEFAULT 'ZERO',
  ADD COLUMN "feePercentageBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "feeFixedTambala" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "feePolicyId" UUID,
  ADD COLUMN "feePolicyVersion" INTEGER;

CREATE TABLE "fee_policies" (
  "id" UUID NOT NULL,
  "merchantId" UUID,
  "type" "FeeType" NOT NULL,
  "percentageBps" INTEGER NOT NULL DEFAULT 0,
  "fixedAmountTambala" BIGINT NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL,
  "version" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "fee_policies_percentage_bounds" CHECK ("percentageBps" BETWEEN 0 AND 9999),
  CONSTRAINT "fee_policies_fixed_nonnegative" CHECK ("fixedAmountTambala" >= 0),
  CONSTRAINT "fee_policies_version_positive" CHECK ("version" > 0),
  CONSTRAINT "fee_policies_type_parameters_valid" CHECK (
    ("type" = 'ZERO' AND "percentageBps" = 0 AND "fixedAmountTambala" = 0)
    OR ("type" = 'PERCENTAGE' AND "percentageBps" >= 0 AND "fixedAmountTambala" = 0)
    OR ("type" = 'FIXED' AND "percentageBps" = 0 AND "fixedAmountTambala" >= 0)
    OR ("type" = 'HYBRID' AND "percentageBps" >= 0 AND "fixedAmountTambala" >= 0)
  )
);

CREATE TABLE "fee_policy_audit_events" (
  "id" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "action" "FeePolicyAuditAction" NOT NULL,
  "source" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fee_policy_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_accounts" (
  "id" UUID NOT NULL,
  "key" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" "LedgerAccountType" NOT NULL,
  "normalBalance" "LedgerNormalBalance" NOT NULL,
  "status" "LedgerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "currency" VARCHAR(3) NOT NULL,
  "merchantId" UUID,
  "provider" "PaymentProvider",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_accounts_owner_shape" CHECK (
    ("code" = 'MERCHANT_PENDING' AND "merchantId" IS NOT NULL AND "provider" IS NULL)
    OR ("code" = 'PROVIDER_CLEARING' AND "merchantId" IS NULL AND "provider" IS NOT NULL)
    OR ("code" = 'PLATFORM_FEE_REVENUE' AND "merchantId" IS NULL AND "provider" IS NULL)
  )
);

CREATE TABLE "ledger_account_balances" (
  "id" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "debitTotal" BIGINT NOT NULL DEFAULT 0,
  "creditTotal" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ledger_account_balances_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_account_balances_nonnegative" CHECK ("debitTotal" >= 0 AND "creditTotal" >= 0)
);

CREATE TABLE "ledger_transactions" (
  "id" UUID NOT NULL,
  "reference" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "postingPurpose" TEXT NOT NULL,
  "type" "LedgerTransactionType" NOT NULL,
  "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'PENDING',
  "currency" VARCHAR(3) NOT NULL,
  "description" TEXT,
  "provenance" TEXT,
  "backfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "postedAt" TIMESTAMP(3),
  CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
  "id" UUID NOT NULL,
  "ledgerTransactionId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "direction" "LedgerEntryDirection" NOT NULL,
  "amountTambala" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ledger_entries_amount_positive" CHECK ("amountTambala" > 0)
);

CREATE UNIQUE INDEX "fee_policies_active_platform_currency_key"
  ON "fee_policies" ("currency") WHERE "merchantId" IS NULL AND "active";
CREATE UNIQUE INDEX "fee_policies_active_merchant_currency_key"
  ON "fee_policies" ("merchantId", "currency") WHERE "merchantId" IS NOT NULL AND "active";
CREATE UNIQUE INDEX "fee_policies_platform_version_key"
  ON "fee_policies" ("currency", "version") WHERE "merchantId" IS NULL;
CREATE UNIQUE INDEX "fee_policies_merchant_version_key"
  ON "fee_policies" ("merchantId", "currency", "version") WHERE "merchantId" IS NOT NULL;
CREATE INDEX "fee_policies_merchantId_currency_active_idx"
  ON "fee_policies" ("merchantId", "currency", "active");
CREATE INDEX "fee_policy_audit_events_policyId_occurredAt_idx"
  ON "fee_policy_audit_events" ("policyId", "occurredAt");
CREATE UNIQUE INDEX "ledger_accounts_key_key" ON "ledger_accounts" ("key");
CREATE INDEX "ledger_accounts_merchantId_currency_idx" ON "ledger_accounts" ("merchantId", "currency");
CREATE INDEX "ledger_accounts_provider_currency_idx" ON "ledger_accounts" ("provider", "currency");
CREATE INDEX "ledger_accounts_type_status_idx" ON "ledger_accounts" ("type", "status");
CREATE UNIQUE INDEX "ledger_account_balances_accountId_key" ON "ledger_account_balances" ("accountId");
CREATE UNIQUE INDEX "ledger_transactions_reference_key" ON "ledger_transactions" ("reference");
CREATE UNIQUE INDEX "ledger_transactions_sourceType_sourceId_postingPurpose_key"
  ON "ledger_transactions" ("sourceType", "sourceId", "postingPurpose");
CREATE INDEX "ledger_transactions_type_status_createdAt_idx"
  ON "ledger_transactions" ("type", "status", "createdAt");
CREATE INDEX "ledger_entries_accountId_createdAt_idx" ON "ledger_entries" ("accountId", "createdAt");
CREATE INDEX "ledger_entries_ledgerTransactionId_idx" ON "ledger_entries" ("ledgerTransactionId");

ALTER TABLE "payment_transactions"
  ADD CONSTRAINT "payment_transactions_feePolicyId_fkey"
  FOREIGN KEY ("feePolicyId") REFERENCES "fee_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_policies"
  ADD CONSTRAINT "fee_policies_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "fee_policy_audit_events"
  ADD CONSTRAINT "fee_policy_audit_events_policyId_fkey"
  FOREIGN KEY ("policyId") REFERENCES "fee_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_merchantId_fkey"
  FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_account_balances"
  ADD CONSTRAINT "ledger_account_balances_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_ledgerTransactionId_fkey"
  FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_entries_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_fee_policy_definition_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."id" <> NEW."id"
    OR OLD."merchantId" IS DISTINCT FROM NEW."merchantId"
    OR OLD."type" IS DISTINCT FROM NEW."type"
    OR OLD."percentageBps" IS DISTINCT FROM NEW."percentageBps"
    OR OLD."fixedAmountTambala" IS DISTINCT FROM NEW."fixedAmountTambala"
    OR OLD."currency" IS DISTINCT FROM NEW."currency"
    OR OLD."version" IS DISTINCT FROM NEW."version"
    OR OLD."source" IS DISTINCT FROM NEW."source"
    OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Fee policy definitions are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fee_policies_immutable_definition"
  BEFORE UPDATE ON "fee_policies"
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_policy_definition_mutation();

CREATE FUNCTION prevent_fee_policy_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Fee policy audit events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "fee_policy_audit_events_append_only"
  BEFORE UPDATE OR DELETE ON "fee_policy_audit_events"
  FOR EACH ROW EXECUTE FUNCTION prevent_fee_policy_audit_mutation();

CREATE FUNCTION prevent_posted_ledger_transaction_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Posted ledger transactions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ledger_transactions_immutable_after_posting"
  BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_ledger_transaction_mutation();

CREATE FUNCTION prevent_posted_ledger_entry_mutation() RETURNS trigger AS $$
DECLARE
  transaction_status "LedgerTransactionStatus";
BEGIN
  SELECT "status" INTO transaction_status
  FROM "ledger_transactions"
  WHERE "id" = COALESCE(NEW."ledgerTransactionId", OLD."ledgerTransactionId");
  IF transaction_status = 'POSTED' THEN
    RAISE EXCEPTION 'Entries in posted ledger transactions are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ledger_entries_immutable_after_posting"
  BEFORE INSERT OR UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION prevent_posted_ledger_entry_mutation();

CREATE FUNCTION enforce_posted_ledger_balance() RETURNS trigger AS $$
DECLARE
  transaction_id UUID;
  transaction_status "LedgerTransactionStatus";
  transaction_currency VARCHAR(3);
  entry_count BIGINT;
  mismatched_currency_count BIGINT;
  debit_total NUMERIC;
  credit_total NUMERIC;
BEGIN
  IF TG_TABLE_NAME = 'ledger_transactions' THEN
    transaction_id := NEW."id";
  ELSIF TG_OP = 'DELETE' THEN
    transaction_id := OLD."ledgerTransactionId";
  ELSE
    transaction_id := NEW."ledgerTransactionId";
  END IF;
  SELECT "status", "currency" INTO transaction_status, transaction_currency
  FROM "ledger_transactions" WHERE "id" = transaction_id;
  IF transaction_status = 'POSTED' THEN
    SELECT COUNT(*),
      COALESCE(SUM(entry."amountTambala") FILTER (WHERE entry."direction" = 'DEBIT'), 0),
      COALESCE(SUM(entry."amountTambala") FILTER (WHERE entry."direction" = 'CREDIT'), 0),
      COUNT(*) FILTER (WHERE account."currency" <> transaction_currency)
    INTO entry_count, debit_total, credit_total, mismatched_currency_count
    FROM "ledger_entries" entry
    JOIN "ledger_accounts" account ON account."id" = entry."accountId"
    WHERE entry."ledgerTransactionId" = transaction_id;
    IF entry_count < 2 OR debit_total <> credit_total OR mismatched_currency_count <> 0 THEN
      RAISE EXCEPTION 'Posted ledger transaction must contain at least two balanced entries in one currency';
    END IF;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE CONSTRAINT TRIGGER "ledger_transactions_must_balance"
  AFTER INSERT OR UPDATE ON "ledger_transactions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enforce_posted_ledger_balance();
CREATE CONSTRAINT TRIGGER "ledger_entries_must_balance"
  AFTER INSERT OR UPDATE OR DELETE ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  EXECUTE FUNCTION enforce_posted_ledger_balance();

INSERT INTO "ledger_accounts" (
  "id", "key", "code", "name", "type", "normalBalance", "status", "currency", "merchantId", "provider", "updatedAt"
) VALUES
  ('00000000-0000-4000-8000-000000000010', 'provider-clearing:MWK:AIRTEL_MONEY', 'PROVIDER_CLEARING', 'Airtel Money clearing', 'ASSET', 'DEBIT', 'ACTIVE', 'MWK', NULL, 'AIRTEL_MONEY', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000011', 'provider-clearing:MWK:TN_MPAMBA', 'PROVIDER_CLEARING', 'TN Mpamba clearing', 'ASSET', 'DEBIT', 'ACTIVE', 'MWK', NULL, 'TNM_MPAMBA', CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000012', 'provider-clearing:MWK:TEST', 'PROVIDER_CLEARING', 'Test provider clearing', 'ASSET', 'DEBIT', 'ACTIVE', 'MWK', NULL, 'TEST', CURRENT_TIMESTAMP);
INSERT INTO "ledger_account_balances" ("id", "accountId", "debitTotal", "creditTotal", "updatedAt") VALUES
  ('00000000-0000-4000-8000-000000000020', '00000000-0000-4000-8000-000000000010', 0, 0, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000021', '00000000-0000-4000-8000-000000000011', 0, 0, CURRENT_TIMESTAMP),
  ('00000000-0000-4000-8000-000000000022', '00000000-0000-4000-8000-000000000012', 0, 0, CURRENT_TIMESTAMP);

INSERT INTO "fee_policies" (
  "id", "merchantId", "type", "percentageBps", "fixedAmountTambala",
  "currency", "version", "active", "source"
) VALUES (
  '00000000-0000-4000-8000-000000000001', NULL, 'ZERO', 0, 0,
  'MWK', 1, TRUE, 'migration:20261117090000_add_fee_policies_and_ledger'
);
INSERT INTO "fee_policy_audit_events" ("id", "policyId", "action", "source") VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'CREATED', 'migration:20261117090000_add_fee_policies_and_ledger'),
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'ACTIVATED', 'migration:20261117090000_add_fee_policies_and_ledger');

UPDATE "payment_transactions"
SET "feeTambala" = 0,
    "merchantNetTambala" = "amount"::BIGINT,
    "feeType" = 'ZERO',
    "feePercentageBps" = 0,
    "feeFixedTambala" = 0,
    "feePolicyId" = '00000000-0000-4000-8000-000000000001',
    "feePolicyVersion" = 1;
ALTER TABLE "payment_transactions"
  ALTER COLUMN "merchantNetTambala" SET NOT NULL,
  ALTER COLUMN "feePolicyId" SET NOT NULL,
  ALTER COLUMN "feePolicyVersion" SET NOT NULL,
  ADD CONSTRAINT "payment_transactions_fee_snapshot_valid" CHECK (
    "feeTambala" >= 0 AND "merchantNetTambala" > 0
    AND "feeTambala" + "merchantNetTambala" = "amount"::BIGINT
  );

CREATE FUNCTION prevent_payment_fee_snapshot_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."feeTambala" IS DISTINCT FROM NEW."feeTambala"
    OR OLD."merchantNetTambala" IS DISTINCT FROM NEW."merchantNetTambala"
    OR OLD."feeType" IS DISTINCT FROM NEW."feeType"
    OR OLD."feePercentageBps" IS DISTINCT FROM NEW."feePercentageBps"
    OR OLD."feeFixedTambala" IS DISTINCT FROM NEW."feeFixedTambala"
    OR OLD."feePolicyId" IS DISTINCT FROM NEW."feePolicyId"
    OR OLD."feePolicyVersion" IS DISTINCT FROM NEW."feePolicyVersion" THEN
    RAISE EXCEPTION 'Payment fee snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payment_transactions_fee_snapshot_immutable"
  BEFORE UPDATE ON "payment_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_payment_fee_snapshot_mutation();
