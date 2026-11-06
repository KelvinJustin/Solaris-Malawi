-- AlterTable
ALTER TABLE "merchant_documents" ADD COLUMN     "supersededAt" TIMESTAMP(3),
ADD COLUMN     "supersededByDocumentId" UUID;

-- CreateIndex
CREATE INDEX "merchant_documents_supersededByDocumentId_idx" ON "merchant_documents"("supersededByDocumentId");

-- AddForeignKey
ALTER TABLE "merchant_documents" ADD CONSTRAINT "merchant_documents_supersededByDocumentId_fkey" FOREIGN KEY ("supersededByDocumentId") REFERENCES "merchant_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
