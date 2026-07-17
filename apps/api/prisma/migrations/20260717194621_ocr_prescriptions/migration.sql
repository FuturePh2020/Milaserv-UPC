-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'REVIEW', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PrescriptionLineStatus" AS ENUM ('SUGGESTED', 'CONFIRMED', 'CORRECTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'UPLOADED',
    "attachmentId" TEXT,
    "uploadedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "ticketId" TEXT,
    "relatedOrderNo" TEXT,
    "note" TEXT,
    "engineMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionLine" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "rawText" TEXT NOT NULL,
    "engineConfidence" DOUBLE PRECISION,
    "matchScore" DOUBLE PRECISION,
    "matchedDrugId" TEXT,
    "status" "PrescriptionLineStatus" NOT NULL DEFAULT 'SUGGESTED',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Prescription_number_key" ON "Prescription"("number");

-- CreateIndex
CREATE INDEX "Prescription_status_createdAt_idx" ON "Prescription"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Prescription_uploadedById_idx" ON "Prescription"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionLine_prescriptionId_lineNo_key" ON "PrescriptionLine"("prescriptionId", "lineNo");

-- AddForeignKey
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionLine" ADD CONSTRAINT "PrescriptionLine_matchedDrugId_fkey" FOREIGN KEY ("matchedDrugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;
