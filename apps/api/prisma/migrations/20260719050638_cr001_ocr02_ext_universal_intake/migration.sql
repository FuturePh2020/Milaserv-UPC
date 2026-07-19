-- CreateEnum
CREATE TYPE "PrescriptionSourceType" AS ENUM ('CAMERA', 'SCANNER', 'SCREENSHOT', 'WHATSAPP_SCREENSHOT', 'PDF', 'UNKNOWN');

-- AlterTable
ALTER TABLE "PrescriptionPage" ADD COLUMN     "clipboardPasted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "detectedDocumentRegionJson" JSONB,
ADD COLUMN     "manualCropJson" JSONB,
ADD COLUMN     "manualCropRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "originalHeight" INTEGER,
ADD COLUMN     "originalWidth" INTEGER,
ADD COLUMN     "regionDetectionConfidence" DOUBLE PRECISION,
ADD COLUMN     "screenshotApplicationHint" TEXT,
ADD COLUMN     "screenshotDetected" BOOLEAN,
ADD COLUMN     "selectedRegionIndex" INTEGER,
ADD COLUMN     "sourceType" "PrescriptionSourceType" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "PrescriptionRegion" (
    "id" TEXT NOT NULL,
    "prescriptionPageId" TEXT NOT NULL,
    "regionIndex" INTEGER NOT NULL,
    "boundingBoxJson" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "regionType" TEXT,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "processingStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "spawnedPageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionRegion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionRegion_prescriptionPageId_idx" ON "PrescriptionRegion"("prescriptionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionRegion_prescriptionPageId_regionIndex_key" ON "PrescriptionRegion"("prescriptionPageId", "regionIndex");

-- AddForeignKey
ALTER TABLE "PrescriptionRegion" ADD CONSTRAINT "PrescriptionRegion_prescriptionPageId_fkey" FOREIGN KEY ("prescriptionPageId") REFERENCES "PrescriptionPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
