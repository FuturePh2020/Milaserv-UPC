-- AlterTable
ALTER TABLE "PrescriptionPage" ADD COLUMN     "contentHash" TEXT;

-- CreateIndex
CREATE INDEX "PrescriptionPage_contentHash_idx" ON "PrescriptionPage"("contentHash");
