/*
  Warnings:

  - A unique constraint covering the columns `[PIN]` on the table `merchants` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `password` to the `merchants` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "PIN" TEXT,
ADD COLUMN     "password" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "merchants_PIN_key" ON "merchants"("PIN");
