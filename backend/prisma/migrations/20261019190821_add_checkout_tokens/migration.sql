/*
  Warnings:

  - A unique constraint covering the columns `[checkoutTokenHash]` on the table `payment_transactions` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "payment_transactions" ADD COLUMN     "checkoutCreatedAt" TIMESTAMP(3),
ADD COLUMN     "checkoutExpiresAt" TIMESTAMP(3),
ADD COLUMN     "checkoutTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "payment_transactions_checkoutTokenHash_key" ON "payment_transactions"("checkoutTokenHash");
