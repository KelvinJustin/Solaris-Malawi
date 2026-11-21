CREATE TYPE "PaymentType" AS ENUM ('MWK', 'CRYPTO');

ALTER TABLE "payment_transactions"
  ADD COLUMN "paymentType" "PaymentType" NOT NULL DEFAULT 'MWK';

CREATE TABLE "mwk_payment_details" (
  "transactionId" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'MWK',
  "feeTambala" BIGINT NOT NULL DEFAULT 0,
  "merchantNetTambala" BIGINT NOT NULL,
  "feeType" "FeeType" NOT NULL DEFAULT 'ZERO',
  "feePercentageBps" INTEGER NOT NULL DEFAULT 0,
  "feeFixedTambala" BIGINT NOT NULL DEFAULT 0,
  "feePolicyId" UUID NOT NULL,
  "feePolicyVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mwk_payment_details_pkey" PRIMARY KEY ("transactionId")
);

CREATE TABLE "legacy_mwk_payment_snapshots" (
  "transactionId" UUID NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "feeTambala" BIGINT NOT NULL,
  "merchantNetTambala" BIGINT NOT NULL,
  "feeType" "FeeType" NOT NULL,
  "feePercentageBps" INTEGER NOT NULL,
  "feeFixedTambala" BIGINT NOT NULL,
  "feePolicyId" UUID NOT NULL,
  "feePolicyVersion" INTEGER NOT NULL,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "legacy_mwk_payment_snapshots_pkey" PRIMARY KEY ("transactionId")
);

ALTER TABLE "crypto_payment_details"
  ADD COLUMN "transactionId" UUID,
  ADD COLUMN "asset" TEXT,
  ADD COLUMN "requestedAmount" DECIMAL(36,18),
  ADD COLUMN "providerCurrency" TEXT,
  ADD COLUMN "feeAmount" DECIMAL(36,18),
  ADD COLUMN "merchantNetAmount" DECIMAL(36,18);

UPDATE "crypto_payment_details" AS detail
SET
  "transactionId" = attempt."transactionId",
  "asset" = CASE LOWER(detail."payCurrency")
    WHEN 'usdttrc20' THEN 'USDT'
    WHEN 'usdterc20' THEN 'USDT'
    WHEN 'usdtbep20' THEN 'USDT'
    WHEN 'usdcerc20' THEN 'USDC'
    WHEN 'usdcbep20' THEN 'USDC'
    WHEN 'btc' THEN 'BTC'
    WHEN 'eth' THEN 'ETH'
    WHEN 'bnb' THEN 'BNB'
    WHEN 'trx' THEN 'TRX'
    WHEN 'ltc' THEN 'LTC'
    WHEN 'doge' THEN 'DOGE'
    ELSE UPPER(detail."payCurrency")
  END,
  "network" = CASE LOWER(detail."payCurrency")
    WHEN 'usdttrc20' THEN 'TRC20'
    WHEN 'usdterc20' THEN 'ERC20'
    WHEN 'usdtbep20' THEN 'BEP20'
    WHEN 'usdcerc20' THEN 'ERC20'
    WHEN 'usdcbep20' THEN 'BEP20'
    ELSE NULL
  END,
  "requestedAmount" = detail."payAmount",
  "providerCurrency" = detail."payCurrency"
FROM "payment_attempts" AS attempt
WHERE detail."attemptId" = attempt."id";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "crypto_payment_details"
    GROUP BY "transactionId"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot split payment financial details: more than one crypto detail exists for a transaction';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "crypto_payment_details"
    WHERE "transactionId" IS NULL
       OR "asset" IS NULL
       OR "requestedAmount" IS NULL
       OR "providerCurrency" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot split payment financial details: a crypto detail could not be linked to its transaction';
  END IF;
END
$$;

INSERT INTO "legacy_mwk_payment_snapshots" (
  "transactionId",
  "amount",
  "currency",
  "feeTambala",
  "merchantNetTambala",
  "feeType",
  "feePercentageBps",
  "feeFixedTambala",
  "feePolicyId",
  "feePolicyVersion"
)
SELECT
  transaction."id",
  transaction."amount",
  transaction."currency",
  transaction."feeTambala",
  transaction."merchantNetTambala",
  transaction."feeType",
  transaction."feePercentageBps",
  transaction."feeFixedTambala",
  transaction."feePolicyId",
  transaction."feePolicyVersion"
FROM "payment_transactions" AS transaction
WHERE EXISTS (
  SELECT 1
  FROM "crypto_payment_details" AS detail
  WHERE detail."transactionId" = transaction."id"
);

INSERT INTO "mwk_payment_details" (
  "transactionId",
  "amount",
  "currency",
  "feeTambala",
  "merchantNetTambala",
  "feeType",
  "feePercentageBps",
  "feeFixedTambala",
  "feePolicyId",
  "feePolicyVersion",
  "createdAt",
  "updatedAt"
)
SELECT
  transaction."id",
  transaction."amount",
  transaction."currency",
  transaction."feeTambala",
  transaction."merchantNetTambala",
  transaction."feeType",
  transaction."feePercentageBps",
  transaction."feeFixedTambala",
  transaction."feePolicyId",
  transaction."feePolicyVersion",
  transaction."createdAt",
  transaction."updatedAt"
FROM "payment_transactions" AS transaction
WHERE NOT EXISTS (
  SELECT 1
  FROM "crypto_payment_details" AS detail
  WHERE detail."transactionId" = transaction."id"
);

UPDATE "payment_transactions" AS transaction
SET "paymentType" = 'CRYPTO'
WHERE EXISTS (
  SELECT 1
  FROM "crypto_payment_details" AS detail
  WHERE detail."transactionId" = transaction."id"
);

ALTER TABLE "crypto_payment_details"
  ALTER COLUMN "transactionId" SET NOT NULL,
  ALTER COLUMN "asset" SET NOT NULL,
  ALTER COLUMN "requestedAmount" SET NOT NULL,
  ALTER COLUMN "providerCurrency" SET NOT NULL,
  ALTER COLUMN "attemptId" DROP NOT NULL,
  ALTER COLUMN "nowpaymentsPaymentId" DROP NOT NULL,
  ALTER COLUMN "payAmount" DROP NOT NULL,
  ALTER COLUMN "priceCurrency" DROP NOT NULL,
  ALTER COLUMN "priceAmount" TYPE DECIMAL(36,18),
  ALTER COLUMN "priceAmount" DROP NOT NULL,
  ALTER COLUMN "fxRateMwkToPriceCurrency" DROP NOT NULL,
  ALTER COLUMN "fxRateCapturedAt" DROP NOT NULL,
  ALTER COLUMN "paymentAddress" DROP NOT NULL;

DROP INDEX "crypto_payment_details_attemptId_key";
CREATE UNIQUE INDEX "crypto_payment_details_transactionId_key"
  ON "crypto_payment_details"("transactionId");
CREATE UNIQUE INDEX "crypto_payment_details_attemptId_key"
  ON "crypto_payment_details"("attemptId");
CREATE INDEX "crypto_payment_details_asset_network_idx"
  ON "crypto_payment_details"("asset", "network");

ALTER TABLE "crypto_payment_details"
  DROP COLUMN "payCurrency",
  ADD CONSTRAINT "crypto_payment_details_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "payment_transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "mwk_payment_details_feePolicyId_idx"
  ON "mwk_payment_details"("feePolicyId");
CREATE INDEX "legacy_mwk_payment_snapshots_feePolicyId_idx"
  ON "legacy_mwk_payment_snapshots"("feePolicyId");

ALTER TABLE "mwk_payment_details"
  ADD CONSTRAINT "mwk_payment_details_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "payment_transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "mwk_payment_details_feePolicyId_fkey"
    FOREIGN KEY ("feePolicyId") REFERENCES "fee_policies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "legacy_mwk_payment_snapshots"
  ADD CONSTRAINT "legacy_mwk_payment_snapshots_transactionId_fkey"
    FOREIGN KEY ("transactionId") REFERENCES "payment_transactions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "legacy_mwk_payment_snapshots_feePolicyId_fkey"
    FOREIGN KEY ("feePolicyId") REFERENCES "fee_policies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payment_transactions"
  DROP CONSTRAINT "payment_transactions_feePolicyId_fkey",
  DROP COLUMN "amount",
  DROP COLUMN "currency",
  DROP COLUMN "feeTambala",
  DROP COLUMN "merchantNetTambala",
  DROP COLUMN "feeType",
  DROP COLUMN "feePercentageBps",
  DROP COLUMN "feeFixedTambala",
  DROP COLUMN "feePolicyId",
  DROP COLUMN "feePolicyVersion";

CREATE FUNCTION enforce_payment_detail_exclusivity() RETURNS trigger AS $$
DECLARE
  payment_id UUID;
  payment_type "PaymentType";
  is_mwk BOOLEAN;
  is_crypto BOOLEAN;
  payment_provider "PaymentProvider";
BEGIN
  IF TG_TABLE_NAME = 'payment_transactions' THEN
    IF TG_OP = 'DELETE' THEN
      payment_id := OLD."id";
    ELSE
      payment_id := NEW."id";
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    payment_id := OLD."transactionId";
  ELSE
    payment_id := NEW."transactionId";
  END IF;

  SELECT "paymentType", "provider"
    INTO payment_type, payment_provider
    FROM "payment_transactions"
    WHERE "id" = payment_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM "mwk_payment_details" WHERE "transactionId" = payment_id
  ), EXISTS (
    SELECT 1 FROM "crypto_payment_details" WHERE "transactionId" = payment_id
  ) INTO is_mwk, is_crypto;

  IF payment_type = 'MWK' AND (NOT is_mwk OR is_crypto) THEN
    RAISE EXCEPTION 'MWK payment % must have exactly one MWK detail', payment_id;
  END IF;
  IF payment_type = 'CRYPTO'
     AND (
       NOT is_crypto
       OR is_mwk
       OR payment_provider IS DISTINCT FROM 'NOWPAYMENTS'
     ) THEN
    RAISE EXCEPTION 'Crypto payment % must have exactly one NOWPayments crypto detail', payment_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payment_transactions_detail_exclusivity"
  AFTER INSERT OR UPDATE ON "payment_transactions"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_detail_exclusivity();
CREATE CONSTRAINT TRIGGER "mwk_payment_details_exclusivity"
  AFTER INSERT OR UPDATE OR DELETE ON "mwk_payment_details"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_detail_exclusivity();
CREATE CONSTRAINT TRIGGER "crypto_payment_details_exclusivity"
  AFTER INSERT OR UPDATE OR DELETE ON "crypto_payment_details"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enforce_payment_detail_exclusivity();

CREATE FUNCTION prevent_started_payment_type_mutation() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'CREATED'
     AND (OLD."paymentType" IS DISTINCT FROM NEW."paymentType"
       OR OLD."provider" IS DISTINCT FROM NEW."provider") THEN
    RAISE EXCEPTION 'Payment type and provider are immutable after processing starts';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payment_transactions_type_immutable_after_start"
  BEFORE UPDATE ON "payment_transactions"
  FOR EACH ROW EXECUTE FUNCTION prevent_started_payment_type_mutation();

CREATE FUNCTION prevent_started_payment_terms_mutation() RETURNS trigger AS $$
DECLARE
  payment_id UUID;
  payment_status "PaymentStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    payment_id := NEW."transactionId";
  ELSE
    payment_id := OLD."transactionId";
  END IF;

  SELECT "status" INTO payment_status
  FROM "payment_transactions"
  WHERE "id" = payment_id;

  IF payment_status <> 'CREATED' THEN
    IF TG_OP IN ('INSERT', 'DELETE') THEN
      RAISE EXCEPTION 'Payment details cannot be inserted or deleted after processing starts';
    END IF;

    IF TG_TABLE_NAME = 'mwk_payment_details' AND (
      OLD."amount" IS DISTINCT FROM NEW."amount"
      OR OLD."currency" IS DISTINCT FROM NEW."currency"
      OR OLD."feeTambala" IS DISTINCT FROM NEW."feeTambala"
      OR OLD."merchantNetTambala" IS DISTINCT FROM NEW."merchantNetTambala"
      OR OLD."feeType" IS DISTINCT FROM NEW."feeType"
      OR OLD."feePercentageBps" IS DISTINCT FROM NEW."feePercentageBps"
      OR OLD."feeFixedTambala" IS DISTINCT FROM NEW."feeFixedTambala"
      OR OLD."feePolicyId" IS DISTINCT FROM NEW."feePolicyId"
      OR OLD."feePolicyVersion" IS DISTINCT FROM NEW."feePolicyVersion"
    ) THEN
      RAISE EXCEPTION 'MWK payment terms are immutable after processing starts';
    END IF;

    IF TG_TABLE_NAME = 'crypto_payment_details' AND (
      OLD."asset" IS DISTINCT FROM NEW."asset"
      OR OLD."network" IS DISTINCT FROM NEW."network"
      OR OLD."requestedAmount" IS DISTINCT FROM NEW."requestedAmount"
      OR OLD."providerCurrency" IS DISTINCT FROM NEW."providerCurrency"
    ) THEN
      RAISE EXCEPTION 'Crypto payment terms are immutable after processing starts';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "mwk_payment_details_terms_immutable_after_start"
  BEFORE INSERT OR UPDATE OR DELETE ON "mwk_payment_details"
  FOR EACH ROW EXECUTE FUNCTION prevent_started_payment_terms_mutation();
CREATE TRIGGER "crypto_payment_details_terms_immutable_after_start"
  BEFORE INSERT OR UPDATE OR DELETE ON "crypto_payment_details"
  FOR EACH ROW EXECUTE FUNCTION prevent_started_payment_terms_mutation();
