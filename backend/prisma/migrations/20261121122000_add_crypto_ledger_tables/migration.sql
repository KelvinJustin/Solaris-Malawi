-- CreateTable
CREATE TABLE "crypto_ledger_accounts" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "normalBalance" "LedgerNormalBalance" NOT NULL,
    "status" "LedgerAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "asset" TEXT NOT NULL,
    "network" TEXT,
    "merchantId" UUID,
    "provider" "PaymentProvider",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_ledger_account_balances" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debitTotal" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "creditTotal" DECIMAL(36,18) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_ledger_account_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_ledger_transactions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "postingPurpose" TEXT NOT NULL,
    "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "provenance" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),

    CONSTRAINT "crypto_ledger_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_ledger_entries" (
    "id" UUID NOT NULL,
    "cryptoLedgerTransactionId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "direction" "LedgerEntryDirection" NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crypto_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crypto_ledger_accounts_key_key" ON "crypto_ledger_accounts"("key");
CREATE INDEX "crypto_ledger_accounts_merchantId_asset_network_idx" ON "crypto_ledger_accounts"("merchantId", "asset", "network");
CREATE INDEX "crypto_ledger_accounts_provider_asset_network_idx" ON "crypto_ledger_accounts"("provider", "asset", "network");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_ledger_account_balances_accountId_key" ON "crypto_ledger_account_balances"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_ledger_transactions_reference_key" ON "crypto_ledger_transactions"("reference");
CREATE UNIQUE INDEX "crypto_ledger_transactions_sourceType_sourceId_postingPurpo_key" ON "crypto_ledger_transactions"("sourceType", "sourceId", "postingPurpose");

-- CreateIndex
CREATE INDEX "crypto_ledger_entries_accountId_createdAt_idx" ON "crypto_ledger_entries"("accountId", "createdAt");
CREATE INDEX "crypto_ledger_entries_cryptoLedgerTransactionId_idx" ON "crypto_ledger_entries"("cryptoLedgerTransactionId");

-- AddForeignKey
ALTER TABLE "crypto_ledger_account_balances" ADD CONSTRAINT "crypto_ledger_account_balances_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "crypto_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_ledger_entries" ADD CONSTRAINT "crypto_ledger_entries_cryptoLedgerTransactionId_fkey" FOREIGN KEY ("cryptoLedgerTransactionId") REFERENCES "crypto_ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_ledger_entries" ADD CONSTRAINT "crypto_ledger_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "crypto_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
