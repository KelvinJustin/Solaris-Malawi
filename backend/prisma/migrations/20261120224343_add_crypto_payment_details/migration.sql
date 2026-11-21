-- CreateTable
CREATE TABLE "crypto_payment_details" (
    "id" UUID NOT NULL,
    "attemptId" UUID NOT NULL,
    "nowpaymentsPaymentId" TEXT NOT NULL,
    "payCurrency" TEXT NOT NULL,
    "payAmount" DECIMAL(36,18) NOT NULL,
    "priceCurrency" TEXT NOT NULL,
    "priceAmount" DECIMAL(20,2) NOT NULL,
    "fxRateMwkToPriceCurrency" DECIMAL(20,8) NOT NULL,
    "fxRateCapturedAt" TIMESTAMP(3) NOT NULL,
    "paymentAddress" TEXT NOT NULL,
    "network" TEXT,
    "lastReportedStatus" TEXT,
    "actuallyPaidAmount" DECIMAL(36,18),
    "invoiceExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crypto_payment_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crypto_payment_ipn_events" (
    "id" UUID NOT NULL,
    "cryptoPaymentDetailId" UUID NOT NULL,
    "reportedStatus" TEXT NOT NULL,
    "actuallyPaidAmount" DECIMAL(36,18),
    "rawPayload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crypto_payment_ipn_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crypto_payment_details_attemptId_key" ON "crypto_payment_details"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "crypto_payment_details_nowpaymentsPaymentId_key" ON "crypto_payment_details"("nowpaymentsPaymentId");

-- CreateIndex
CREATE INDEX "crypto_payment_details_lastReportedStatus_idx" ON "crypto_payment_details"("lastReportedStatus");

-- CreateIndex
CREATE INDEX "crypto_payment_ipn_events_cryptoPaymentDetailId_receivedAt_idx" ON "crypto_payment_ipn_events"("cryptoPaymentDetailId", "receivedAt");

-- AddForeignKey
ALTER TABLE "crypto_payment_details" ADD CONSTRAINT "crypto_payment_details_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "payment_attempts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crypto_payment_ipn_events" ADD CONSTRAINT "crypto_payment_ipn_events_cryptoPaymentDetailId_fkey" FOREIGN KEY ("cryptoPaymentDetailId") REFERENCES "crypto_payment_details"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "ledger_accounts"
  ("id", "key", "code", "name", "type", "normalBalance", "status", "currency", "merchantId", "provider", "createdAt", "updatedAt")
VALUES
  ('00000000-0000-4000-8000-000000000013', 'provider-clearing:MWK:NOWPAYMENTS', 'PROVIDER_CLEARING', 'NOWPayments clearing', 'ASSET', 'DEBIT', 'ACTIVE', 'MWK', NULL, 'NOWPAYMENTS', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
