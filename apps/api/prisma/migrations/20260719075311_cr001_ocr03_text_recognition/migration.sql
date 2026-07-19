-- AlterTable
ALTER TABLE "OCRCorrection" ADD COLUMN     "markedAs" TEXT,
ADD COLUMN     "ocrTextBlockId" TEXT,
ALTER COLUMN "candidateId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "OCRTextBlock" ADD COLUMN     "blockIndex" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "boundingPolygonJson" JSONB,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "detectedScript" TEXT,
ADD COLUMN     "modelName" TEXT,
ADD COLUMN     "ocrRunId" TEXT,
ADD COLUMN     "providerName" TEXT,
ADD COLUMN     "providerVersion" TEXT,
ADD COLUMN     "recognitionCandidatesJson" JSONB,
ADD COLUMN     "textDirection" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "PrescriptionPage" ADD COLUMN     "currentOcrRunId" TEXT,
ADD COLUMN     "normalizedPageText" TEXT,
ADD COLUMN     "ocrBlockCount" INTEGER,
ADD COLUMN     "ocrCompletedAt" TIMESTAMP(3),
ADD COLUMN     "ocrDurationMs" INTEGER,
ADD COLUMN     "ocrFailureCode" TEXT,
ADD COLUMN     "ocrFailureReason" TEXT,
ADD COLUMN     "ocrModelInfoJson" JSONB,
ADD COLUMN     "ocrPageConfidence" DOUBLE PRECISION,
ADD COLUMN     "ocrProviderName" TEXT,
ADD COLUMN     "ocrProviderVersion" TEXT,
ADD COLUMN     "ocrStartedAt" TIMESTAMP(3),
ADD COLUMN     "rawPageText" TEXT,
ADD COLUMN     "requiresOcrReview" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PrescriptionOcrRun" (
    "id" TEXT NOT NULL,
    "prescriptionPageId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerVersion" TEXT,
    "modelInfoJson" JSONB,
    "trigger" TEXT NOT NULL DEFAULT 'initial',
    "settingsSnapshotJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "blockCount" INTEGER,
    "pageConfidence" DOUBLE PRECISION,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "requestedById" TEXT,

    CONSTRAINT "PrescriptionOcrRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PrescriptionOcrRun_prescriptionPageId_idx" ON "PrescriptionOcrRun"("prescriptionPageId");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionOcrRun_prescriptionPageId_runNumber_key" ON "PrescriptionOcrRun"("prescriptionPageId", "runNumber");

-- CreateIndex
CREATE INDEX "OCRCorrection_ocrTextBlockId_idx" ON "OCRCorrection"("ocrTextBlockId");

-- CreateIndex
CREATE INDEX "OCRTextBlock_ocrRunId_idx" ON "OCRTextBlock"("ocrRunId");

-- AddForeignKey
ALTER TABLE "PrescriptionOcrRun" ADD CONSTRAINT "PrescriptionOcrRun_prescriptionPageId_fkey" FOREIGN KEY ("prescriptionPageId") REFERENCES "PrescriptionPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OCRTextBlock" ADD CONSTRAINT "OCRTextBlock_ocrRunId_fkey" FOREIGN KEY ("ocrRunId") REFERENCES "PrescriptionOcrRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OCRCorrection" ADD CONSTRAINT "OCRCorrection_ocrTextBlockId_fkey" FOREIGN KEY ("ocrTextBlockId") REFERENCES "OCRTextBlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;
