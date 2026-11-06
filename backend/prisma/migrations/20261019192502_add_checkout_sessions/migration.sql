/*
  Warnings:

  - You are about to drop the column `checkoutCreatedAt` on the `payment_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `checkoutExpiresAt` on the `payment_transactions` table. All the data in the column will be lost.
  - You are about to drop the column `checkoutTokenHash` on the `payment_transactions` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "CheckoutSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CONSUMED', 'REVOKED');

-- DropIndex
DROP INDEX "payment_transactions_checkoutTokenHash_key";

-- AlterTable
ALTER TABLE "payment_transactions" DROP COLUMN "checkoutCreatedAt",
DROP COLUMN "checkoutExpiresAt",
DROP COLUMN "checkoutTokenHash";

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" UUID NOT NULL,
    "transactionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEncrypted" TEXT NOT NULL,
    "status" "CheckoutSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_tokenHash_key" ON "checkout_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "checkout_sessions_transactionId_status_idx" ON "checkout_sessions"("transactionId", "status");

-- CreateIndex
CREATE INDEX "checkout_sessions_status_expiresAt_idx" ON "checkout_sessions"("status", "expiresAt");

-- AddForeignKey
ALTER TABLE "checkout_sessions" ADD CONSTRAINT "checkout_sessions_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "payment_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
