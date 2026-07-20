-- CreateEnum
CREATE TYPE "PreprocessingQualityStatus" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'REUPLOAD_REQUIRED');

-- CreateEnum
CREATE TYPE "PrescriptionImageVersionType" AS ENUM ('ORIGINAL', 'ROTATED', 'CROPPED', 'ENHANCED', 'OCR_READY');

-- AlterEnum
ALTER TYPE "PrescriptionPageStatus" ADD VALUE 'READY_FOR_OCR';

-- AlterTable
ALTER TABLE "PrescriptionPage" ADD COLUMN     "blurScore" DOUBLE PRECISION,
ADD COLUMN     "brightnessScore" DOUBLE PRECISION,
ADD COLUMN     "contrastScore" DOUBLE PRECISION,
ADD COLUMN     "cropConfidence" DOUBLE PRECISION,
ADD COLUMN     "finalQualityScore" DOUBLE PRECISION,
ADD COLUMN     "noiseScore" DOUBLE PRECISION,
ADD COLUMN     "preprocessingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "preprocessingDuration" INTEGER,
ADD COLUMN     "preprocessingStartedAt" TIMESTAMP(3),
ADD COLUMN     "preprocessingVersion" TEXT,
ADD COLUMN     "qualityStatus" "PreprocessingQualityStatus",
ADD COLUMN     "rotationAngle" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "PrescriptionPageImageVersion" (
    "id" TEXT NOT NULL,
    "prescriptionPageId" TEXT NOT NULL,
    "versionType" "PrescriptionImageVersionType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "sourcePageIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrescriptionPageImageVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionPageImageVersion_prescriptionPageId_idx" ON "PrescriptionPageImageVersion"("prescriptionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionPageImageVersion_prescriptionPageId_versionType_key" ON "PrescriptionPageImageVersion"("prescriptionPageId", "versionType", "sourcePageIndex");

-- AddForeignKey
ALTER TABLE "PrescriptionPageImageVersion" ADD CONSTRAINT "PrescriptionPageImageVersion_prescriptionPageId_fkey" FOREIGN KEY ("prescriptionPageId") REFERENCES "PrescriptionPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
