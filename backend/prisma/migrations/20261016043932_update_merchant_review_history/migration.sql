/*
  Warnings:

  - You are about to drop the column `performedById` on the `merchant_review_history` table. All the data in the column will be lost.
  - Added the required column `actorType` to the `merchant_review_history` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ProfileActorType" AS ENUM ('MERCHANT', 'ADMIN', 'SYSTEM');

-- DropForeignKey
ALTER TABLE "merchant_review_history" DROP CONSTRAINT "merchant_review_history_performedById_fkey";

-- AlterTable
ALTER TABLE "merchant_profiles" ALTER COLUMN "businessName" DROP NOT NULL,
ALTER COLUMN "businessType" DROP NOT NULL;

-- AlterTable
ALTER TABLE "merchant_review_history" DROP COLUMN "performedById",
ADD COLUMN     "actorId" UUID,
ADD COLUMN     "actorType" "ProfileActorType" NOT NULL;

-- CreateIndex
CREATE INDEX "merchant_review_history_actorType_actorId_idx" ON "merchant_review_history"("actorType", "actorId");
