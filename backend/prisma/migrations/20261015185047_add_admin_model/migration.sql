/*
  Warnings:

  - The `reviewedById` column on the `merchant_documents` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `approvedById` column on the `merchant_profiles` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `performedBy` on the `merchant_review_history` table. All the data in the column will be lost.
  - Added the required column `performedById` to the `merchant_review_history` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'COMPLIANCE', 'OPERATIONS', 'SUPPORT');

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterTable
ALTER TABLE "merchant_documents" DROP COLUMN "reviewedById",
ADD COLUMN     "reviewedById" UUID;

-- AlterTable
ALTER TABLE "merchant_profiles" DROP COLUMN "approvedById",
ADD COLUMN     "approvedById" UUID;

-- AlterTable
ALTER TABLE "merchant_review_history" DROP COLUMN "performedBy",
ADD COLUMN     "performedById" UUID NOT NULL;

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL DEFAULT 'SUPPORT',
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_role_status_idx" ON "admins"("role", "status");

-- AddForeignKey
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_review_history" ADD CONSTRAINT "merchant_review_history_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
