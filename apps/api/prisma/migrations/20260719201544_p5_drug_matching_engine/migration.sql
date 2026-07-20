-- CreateEnum
CREATE TYPE "PrescriptionLineType" AS ENUM ('MEDICATION', 'DOSAGE_INSTRUCTION', 'PATIENT_INFORMATION', 'DOCTOR_INFORMATION', 'DATE', 'DIAGNOSIS', 'HEADER', 'FOOTER', 'WHATSAPP_UI', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MedicationLineMatchingStatus" AS ENUM ('CANDIDATES_FOUND', 'HIGH_CONFIDENCE', 'AMBIGUOUS', 'LOW_CONFIDENCE', 'UNRESOLVED', 'CONFIRMED', 'REJECTED', 'MANUALLY_SELECTED', 'NOT_A_MEDICATION');

-- CreateEnum
CREATE TYPE "DrugMatchRunStatus" AS ENUM ('MATCHING_QUEUED', 'MATCHING_PROCESSING', 'MATCHING_COMPLETED', 'MATCHING_REVIEW_REQUIRED', 'MATCHING_PARTIALLY_RESOLVED', 'MATCHING_RESOLVED', 'MATCHING_FAILED');

-- CreateEnum
CREATE TYPE "MatchConfidenceLevel" AS ENUM ('VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNRESOLVED');

-- CreateEnum
CREATE TYPE "MatchDecisionType" AS ENUM ('CANDIDATE_CONFIRMED', 'CANDIDATE_REJECTED', 'MANUAL_DRUG_SELECTED', 'NO_DRUG_FOUND', 'NON_MEDICATION_LINE', 'REQUIRES_CLARIFICATION');

-- Phase 5 — levenshtein() for edit-distance scoring on the already-
-- narrow trigram-filtered candidate set (never table-wide). pg_trgm was
-- already enabled in the Phase 4 migration.
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;

-- NOTE: the `prisma migrate dev --create-only` diff below originally
-- wanted to DROP the 8 pg_trgm GIN trigram indexes hand-added in the
-- Phase 4 migration (20260719165244_p4_dic_drug_master_foundation) —
-- Prisma's schema DSL has no opclass syntax, so those indexes are
-- invisible to its diff engine and it treats them as extraneous. They
-- are NOT extraneous (Phase 4's `dic.service.ts` search depends on
-- them) and are intentionally NOT dropped here — same discipline as
-- Phase 4's own migration: hand-edit before first apply, never after.

-- AlterTable
ALTER TABLE "PrescriptionDrugCandidate" ADD COLUMN     "candidateMargin" DOUBLE PRECISION,
ADD COLUMN     "confidenceLevel" "MatchConfidenceLevel",
ADD COLUMN     "conflictPenalty" DOUBLE PRECISION,
ADD COLUMN     "conflictsJson" JSONB,
ADD COLUMN     "contextScore" DOUBLE PRECISION,
ADD COLUMN     "dataQualityScore" DOUBLE PRECISION,
ADD COLUMN     "dosageFormScore" DOUBLE PRECISION,
ADD COLUMN     "evidenceJson" JSONB,
ADD COLUMN     "explanationText" TEXT,
ADD COLUMN     "ingredientScore" DOUBLE PRECISION,
ADD COLUMN     "matchRunId" TEXT,
ADD COLUMN     "medicationLineId" TEXT,
ADD COLUMN     "nameScore" DOUBLE PRECISION,
ADD COLUMN     "ocrReliabilityAdjustment" DOUBLE PRECISION,
ADD COLUMN     "rank" INTEGER,
ADD COLUMN     "rejected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "selected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "strengthScore" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "DrugMatchRun" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "ocrRunIdsJson" JSONB NOT NULL,
    "matchingEngineVersion" TEXT NOT NULL,
    "configurationSnapshotJson" JSONB NOT NULL,
    "status" "DrugMatchRunStatus" NOT NULL DEFAULT 'MATCHING_QUEUED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "matchedLineCount" INTEGER NOT NULL DEFAULT 0,
    "unresolvedLineCount" INTEGER NOT NULL DEFAULT 0,
    "initiatedById" TEXT,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugMatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrescriptionMedicationLine" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "prescriptionPageId" TEXT NOT NULL,
    "matchRunId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "rawText" TEXT NOT NULL,
    "normalizedText" TEXT,
    "sourceBlockIdsJson" JSONB NOT NULL,
    "boundingRegionJson" JSONB,
    "probableLineType" "PrescriptionLineType" NOT NULL DEFAULT 'UNKNOWN',
    "detectedLanguage" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "extractionConfidence" DOUBLE PRECISION,
    "matchingStatus" "MedicationLineMatchingStatus" NOT NULL DEFAULT 'CANDIDATES_FOUND',
    "selectedDrugId" TEXT,
    "selectedCandidateId" TEXT,
    "selectedById" TEXT,
    "selectedAt" TIMESTAMP(3),
    "reviewRequired" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrescriptionMedicationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugMatchDecision" (
    "id" TEXT NOT NULL,
    "medicationLineId" TEXT NOT NULL,
    "selectedDrugId" TEXT,
    "selectedCandidateId" TEXT,
    "decisionType" "MatchDecisionType" NOT NULL,
    "decidedById" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "previousDrugId" TEXT,
    "auditMetadataJson" JSONB,

    CONSTRAINT "DrugMatchDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DrugMatchRun_prescriptionId_idx" ON "DrugMatchRun"("prescriptionId");

-- CreateIndex
CREATE INDEX "DrugMatchRun_status_idx" ON "DrugMatchRun"("status");

-- CreateIndex
CREATE INDEX "PrescriptionMedicationLine_prescriptionId_idx" ON "PrescriptionMedicationLine"("prescriptionId");

-- CreateIndex
CREATE INDEX "PrescriptionMedicationLine_prescriptionPageId_idx" ON "PrescriptionMedicationLine"("prescriptionPageId");

-- CreateIndex
CREATE INDEX "PrescriptionMedicationLine_matchingStatus_idx" ON "PrescriptionMedicationLine"("matchingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PrescriptionMedicationLine_matchRunId_lineIndex_key" ON "PrescriptionMedicationLine"("matchRunId", "lineIndex");

-- CreateIndex
CREATE INDEX "DrugMatchDecision_medicationLineId_idx" ON "DrugMatchDecision"("medicationLineId");

-- CreateIndex
CREATE INDEX "PrescriptionDrugCandidate_medicationLineId_idx" ON "PrescriptionDrugCandidate"("medicationLineId");

-- CreateIndex
CREATE INDEX "PrescriptionDrugCandidate_matchRunId_idx" ON "PrescriptionDrugCandidate"("matchRunId");

-- AddForeignKey
ALTER TABLE "PrescriptionDrugCandidate" ADD CONSTRAINT "PrescriptionDrugCandidate_medicationLineId_fkey" FOREIGN KEY ("medicationLineId") REFERENCES "PrescriptionMedicationLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionDrugCandidate" ADD CONSTRAINT "PrescriptionDrugCandidate_matchRunId_fkey" FOREIGN KEY ("matchRunId") REFERENCES "DrugMatchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugMatchRun" ADD CONSTRAINT "DrugMatchRun_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionMedicationLine" ADD CONSTRAINT "PrescriptionMedicationLine_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionMedicationLine" ADD CONSTRAINT "PrescriptionMedicationLine_prescriptionPageId_fkey" FOREIGN KEY ("prescriptionPageId") REFERENCES "PrescriptionPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionMedicationLine" ADD CONSTRAINT "PrescriptionMedicationLine_matchRunId_fkey" FOREIGN KEY ("matchRunId") REFERENCES "DrugMatchRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionMedicationLine" ADD CONSTRAINT "PrescriptionMedicationLine_selectedDrugId_fkey" FOREIGN KEY ("selectedDrugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrescriptionMedicationLine" ADD CONSTRAINT "PrescriptionMedicationLine_selectedCandidateId_fkey" FOREIGN KEY ("selectedCandidateId") REFERENCES "PrescriptionDrugCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugMatchDecision" ADD CONSTRAINT "DrugMatchDecision_medicationLineId_fkey" FOREIGN KEY ("medicationLineId") REFERENCES "PrescriptionMedicationLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugMatchDecision" ADD CONSTRAINT "DrugMatchDecision_selectedDrugId_fkey" FOREIGN KEY ("selectedDrugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugMatchDecision" ADD CONSTRAINT "DrugMatchDecision_selectedCandidateId_fkey" FOREIGN KEY ("selectedCandidateId") REFERENCES "PrescriptionDrugCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
