/*
  Warnings:

  - You are about to drop the column `status` on the `merchants` table. All the data in the column will be lost.
  - You are about to drop the `settlement_accounts` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "settlement_accounts" DROP CONSTRAINT "settlement_accounts_profileId_fkey";

-- AlterTable
ALTER TABLE "merchants" DROP COLUMN "status";

-- DropTable
DROP TABLE "settlement_accounts";

-- DropEnum
DROP TYPE "MerchantStatus";

-- DropEnum
DROP TYPE "SettlementMethod";

-- CreateTable
CREATE TABLE "merchant_ledgers" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "availableBalance" INTEGER NOT NULL DEFAULT 0,
    "pendingBalance" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'MWK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_ledgers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_ledgers_merchantId_key" ON "merchant_ledgers"("merchantId");

-- AddForeignKey
ALTER TABLE "merchant_ledgers" ADD CONSTRAINT "merchant_ledgers_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
