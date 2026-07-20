-- CreateEnum
CREATE TYPE "PrescriptionPageStatus" AS ENUM ('QUEUED', 'ANALYZING_QUALITY', 'PREPROCESSING', 'EXTRACTING_TEXT', 'DETECTING_CANDIDATES', 'COMPLETED', 'IMAGE_REUPLOAD_REQUIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrescriptionCandidateStatus" AS ENUM ('AUTO_MATCHED', 'NEEDS_PHARMACIST_REVIEW', 'AMBIGUOUS_MATCH', 'NOT_FOUND', 'CONFIRMED', 'REJECTED');

-- AlterTable
ALTER TABLE "Prescription" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "detectedLanguage" TEXT,
ADD COLUMN     "overallConfidence" DOUBLE PRECISION,
ADD COLUMN     "processedFileUrl" TEXT,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "PrescriptionPage" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "originalStorageKey" TEXT NOT NULL,
    "enhancedStorageKey" TEXT,
    "imageQualityScore" DOUBLE PRECISION,
    "orientation" INTEGER,
    "processingStatus" "PrescriptionPageStatus" NOT NULL DEFAULT 'QUEUED',
    "processingError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OCRTextBlock" (
    "id" TEXT NOT NULL,
    "prescriptionPageId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT,
    "boundingBox" JSONB,
    "language" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "lineNumber" INTEGER NOT NULL,
    "isMedicineLine" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OCRTextBlock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionDrugCandidate" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "ocrTextBlockId" TEXT,
    "extractedDrugText" TEXT NOT NULL,
    "extractedStrength" TEXT,
    "extractedDosageForm" TEXT,
    "matchedDrugId" TEXT,
    "matchConfidence" DOUBLE PRECISION,
    "status" "PrescriptionCandidateStatus" NOT NULL DEFAULT 'NEEDS_PHARMACIST_REVIEW',
    "matchExplanation" JSONB,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionDrugCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OCRCorrection" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "originalOCRText" TEXT NOT NULL,
    "correctedText" TEXT,
    "originalDrugId" TEXT,
    "correctedDrugId" TEXT,
    "correctedById" TEXT NOT NULL,
    "correctionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OCRCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionPage_processingStatus_idx" ON "PrescriptionPage"("processingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionPage_prescriptionId_pageNumber_key" ON "PrescriptionPage"("prescriptionId", "pageNumber");

-- CreateIndex
CREATE INDEX "OCRTextBlock_prescriptionPageId_idx" ON "OCRTextBlock"("prescriptionPageId");

-- CreateIndex
CREATE INDEX "PrescriptionDrugCandidate_prescriptionId_idx" ON "PrescriptionDrugCandidate"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionDrugCandidate_status_idx" ON "PrescriptionDrugCandidate"("status");

-- CreateIndex
CREATE INDEX "OCRCorrection_candidateId_idx" ON "OCRCorrection"("candidateId");

-- AddForeignKey
ALTER TABLE "PrescriptionPage" ADD CONSTRAINT "PrescriptionPage_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OCRTextBlock" ADD CONSTRAINT "OCRTextBlock_prescriptionPageId_fkey" FOREIGN KEY ("prescriptionPageId") REFERENCES "PrescriptionPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionDrugCandidate" ADD CONSTRAINT "PrescriptionDrugCandidate_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionDrugCandidate" ADD CONSTRAINT "PrescriptionDrugCandidate_ocrTextBlockId_fkey" FOREIGN KEY ("ocrTextBlockId") REFERENCES "OCRTextBlock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionDrugCandidate" ADD CONSTRAINT "PrescriptionDrugCandidate_matchedDrugId_fkey" FOREIGN KEY ("matchedDrugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OCRCorrection" ADD CONSTRAINT "OCRCorrection_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PrescriptionDrugCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
