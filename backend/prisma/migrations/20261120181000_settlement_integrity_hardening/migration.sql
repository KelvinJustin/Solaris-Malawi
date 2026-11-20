ALTER TABLE "provider_settlement_batches"
  DROP CONSTRAINT "provider_settlement_batches_amounts_valid";
ALTER TABLE "provider_settlement_batches"
  ADD CONSTRAINT "provider_settlement_batches_amounts_valid"
  CHECK (
    "grossAmountTambala" > 0
    AND "providerFeeAmountTambala" >= 0
    AND "expectedNetAmountTambala" >= 0
    AND "grossAmountTambala" =
      "providerFeeAmountTambala" + "expectedNetAmountTambala"
  );

CREATE FUNCTION enforce_settlement_allocation_limits() RETURNS trigger AS $$
DECLARE
  batch_net BIGINT;
  batch_currency VARCHAR(3);
  batch_status "SettlementBatchStatus";
  line_credit BIGINT;
  line_debit BIGINT;
  line_status "BankStatementLineStatus";
  line_currency VARCHAR(3);
  batch_allocated BIGINT;
  line_allocated BIGINT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."status" = 'REVERSED' THEN
    RETURN NEW;
  END IF;
  IF NEW."status" <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  SELECT "expectedNetAmountTambala", "currency", "status"
    INTO batch_net, batch_currency, batch_status
  FROM "provider_settlement_batches"
  WHERE "id" = NEW."batchId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement batch does not exist';
  END IF;
  IF batch_status IN ('APPROVED', 'POSTED', 'REJECTED') THEN
    RAISE EXCEPTION 'Bank allocations cannot be created for this settlement batch status';
  END IF;

  SELECT "creditAmountTambala", "debitAmountTambala", "status", "currency"
    INTO line_credit, line_debit, line_status, line_currency
  FROM "bank_statement_lines"
  WHERE "id" = NEW."bankStatementLineId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bank statement line does not exist';
  END IF;
  IF line_status <> 'VALID'
    OR line_credit <= 0
    OR line_debit <> 0
    OR line_currency <> batch_currency THEN
    RAISE EXCEPTION 'Allocation requires a valid bank credit with matching currency';
  END IF;

  SELECT COALESCE(SUM("amountTambala"), 0)
    INTO batch_allocated
  FROM "settlement_bank_allocations"
  WHERE "batchId" = NEW."batchId"
    AND "status" = 'ACTIVE'
    AND ("id" <> NEW."id" OR TG_OP = 'INSERT');
  IF batch_allocated + NEW."amountTambala" > batch_net THEN
    RAISE EXCEPTION 'Settlement batch allocation exceeds expected net';
  END IF;

  SELECT COALESCE(SUM("amountTambala"), 0)
    INTO line_allocated
  FROM "settlement_bank_allocations"
  WHERE "bankStatementLineId" = NEW."bankStatementLineId"
    AND "status" = 'ACTIVE'
    AND ("id" <> NEW."id" OR TG_OP = 'INSERT');
  IF line_allocated + NEW."amountTambala" > line_credit THEN
    RAISE EXCEPTION 'Bank line allocation exceeds its credit amount';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "settlement_bank_allocations_enforce_limits"
  BEFORE INSERT OR UPDATE ON "settlement_bank_allocations"
  FOR EACH ROW EXECUTE FUNCTION enforce_settlement_allocation_limits();
