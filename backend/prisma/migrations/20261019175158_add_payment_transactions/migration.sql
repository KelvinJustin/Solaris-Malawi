-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'PENDING_RECONCILIATION');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('AIRTEL_MONEY', 'TNM_MPAMBA');

-- CreateEnum
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('STARTED', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "payment_transactions" (
    "id" UUID NOT NULL,
    "publicReference" TEXT NOT NULL,
    "merchantId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MWK',
    "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
    "provider" "PaymentProvider",
    "providerReference" TEXT,
    "customerPhone" TEXT NOT NULL,
    "description" TEXT,
    "merchantReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "payment_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempts" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentAttemptStatus" NOT NULL DEFAULT 'STARTED',
    "providerReference" TEXT,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_publicReference_key" ON "payment_transactions"("publicReference");

-- CreateIndex
CREATE INDEX "payment_transactions_merchantId_createdAt_idx" ON "payment_transactions"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_transactions_status_createdAt_idx" ON "payment_transactions"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payment_transactions_merchantId_merchantReference_idx" ON "payment_transactions"("merchantId", "merchantReference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_merchantId_idempotencyKey_key" ON "payment_transactions"("merchantId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_provider_providerReference_key" ON "payment_transactions"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "payment_attempts_provider_providerReference_idx" ON "payment_attempts"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "payment_attempts_status_startedAt_idx" ON "payment_attempts"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempts_transactionId_attemptNumber_key" ON "payment_attempts"("transactionId", "attemptNumber");

-- AddForeignKey
ALTER TABLE "payment_transactions" ADD CONSTRAINT "payment_transactions_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
