/*
  Warnings:

  - A unique constraint covering the columns `[profileId,type]` on the table `merchant_documents` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_documents_profileId_type_key" ON "merchant_documents"("profileId", "type");
