-- CreateTable
CREATE TABLE "admin_revoked_tokens" (
    "id" UUID NOT NULL,
    "jti" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_revoked_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_revoked_tokens_jti_key" ON "admin_revoked_tokens"("jti");

-- CreateIndex
CREATE INDEX "admin_revoked_tokens_adminId_idx" ON "admin_revoked_tokens"("adminId");

-- CreateIndex
CREATE INDEX "admin_revoked_tokens_expiresAt_idx" ON "admin_revoked_tokens"("expiresAt");

-- AddForeignKey
ALTER TABLE "admin_revoked_tokens" ADD CONSTRAINT "admin_revoked_tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
