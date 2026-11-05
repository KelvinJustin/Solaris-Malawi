-- CreateTable
CREATE TABLE "merchant_document_uploads" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "type" "DocumentType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "expectedMimeType" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_document_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "merchant_document_uploads_objectKey_key" ON "merchant_document_uploads"("objectKey");

-- CreateIndex
CREATE INDEX "merchant_document_uploads_profileId_expiresAt_idx" ON "merchant_document_uploads"("profileId", "expiresAt");

-- AddForeignKey
ALTER TABLE "merchant_document_uploads" ADD CONSTRAINT "merchant_document_uploads_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "merchant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
