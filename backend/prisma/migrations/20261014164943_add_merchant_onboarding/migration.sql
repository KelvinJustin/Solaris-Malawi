-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('PENDING_SUBMISSION', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM ('INDIVIDUAL', 'SOLE_TRADER', 'PARTNERSHIP', 'LIMITED_COMPANY', 'NGO');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'BUSINESS_REGISTRATION', 'TAX_CERTIFICATE', 'PROOF_OF_ADDRESS', 'DIRECTOR_ID');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SettlementMethod" AS ENUM ('AIRTEL_MONEY', 'TNM_MPAMBA', 'BANK_TRANSFER');

-- CreateTable
CREATE TABLE "merchant_profiles" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "businessName" TEXT NOT NULL,
    "tradingName" TEXT,
    "businessType" "BusinessType" NOT NULL,
    "businessRegistrationNo" TEXT,
    "taxIdentificationNo" TEXT,
    "merchantCategoryCode" TEXT,
    "industryDescription" TEXT,
    "supportEmail" TEXT,
    "supportPhone" TEXT,
    "websiteUrl" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "district" TEXT,
    "country" TEXT NOT NULL DEFAULT 'MW',
    "logoUrl" TEXT,
    "accountStatus" "AccountStatus" NOT NULL DEFAULT 'PENDING_SUBMISSION',
    "rejectionReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_documents" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "rejectionNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "expiresAt" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlement_accounts" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "method" "SettlementMethod" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "phoneNumber" TEXT,
    "bankName" TEXT,
    "accountName" TEXT,
    "accountNumber" TEXT,
    "branchCode" TEXT,
    "swiftCode" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settlement_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_review_history" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "fromStatus" "AccountStatus" NOT NULL,
    "toStatus" "AccountStatus" NOT NULL,
    "note" TEXT,
    "performedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_review_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_profiles_merchantId_key" ON "merchant_profiles"("merchantId");

-- CreateIndex
CREATE INDEX "merchant_documents_profileId_type_idx" ON "merchant_documents"("profileId", "type");

-- CreateIndex
CREATE INDEX "merchant_documents_status_idx" ON "merchant_documents"("status");

-- CreateIndex
CREATE INDEX "settlement_accounts_profileId_idx" ON "settlement_accounts"("profileId");

-- CreateIndex
CREATE INDEX "settlement_accounts_profileId_method_idx" ON "settlement_accounts"("profileId", "method");

-- CreateIndex
CREATE INDEX "merchant_review_history_profileId_createdAt_idx" ON "merchant_review_history"("profileId", "createdAt");

-- AddForeignKey
ALTER TABLE "merchant_profiles" ADD CONSTRAINT "merchant_profiles_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "merchant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlement_accounts" ADD CONSTRAINT "settlement_accounts_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "merchant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_review_history" ADD CONSTRAINT "merchant_review_history_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "merchant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
