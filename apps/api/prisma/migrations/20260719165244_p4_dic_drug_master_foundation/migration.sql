-- Phase 4 (design doc §9/§15) — fuzzy Arabic/English drug-name matching.
-- Hand-added: Prisma's schema DSL has no trigram-opclass index syntax, so
-- this extension + the GIN indexes near the end of this file are manual,
-- same discipline as CR-001 Sprint OCR-03's hand-added column default.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "DataQualityStatus" AS ENUM ('DRAFT', 'INCOMPLETE', 'NEEDS_REVIEW', 'VERIFIED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('TRADE_NAME', 'SCIENTIFIC_NAME', 'ABBREVIATION', 'COMMON_MISSPELLING', 'OCR_VARIANT', 'LEGACY_NAME', 'ARABIC_TRANSLITERATION', 'ENGLISH_TRANSLITERATION', 'MANUFACTURER_VARIANT', 'PACKAGING_VARIANT', 'USER_CORRECTION', 'IMPORTED_ALIAS');

-- CreateEnum
CREATE TYPE "AliasSource" AS ENUM ('MANUAL', 'IMPORT', 'OCR_CORRECTION', 'LEGACY_DATABASE', 'SYSTEM_GENERATED', 'PHARMACIST_APPROVED');

-- CreateEnum
CREATE TYPE "IngredientRole" AS ENUM ('PRIMARY', 'SECONDARY', 'COMBINATION_COMPONENT', 'EXCIPIENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DrugAlternativeType" AS ENUM ('SAME_ACTIVE_INGREDIENT', 'SAME_ACTIVE_AND_STRENGTH', 'SAME_ACTIVE_DIFFERENT_STRENGTH', 'SAME_DOSAGE_FORM', 'GENERIC_ALTERNATIVE', 'BRAND_ALTERNATIVE', 'THERAPEUTIC_ALTERNATIVE');

-- CreateEnum
CREATE TYPE "CoverageStatus" AS ENUM ('COVERED', 'NOT_COVERED', 'PARTIALLY_COVERED', 'REQUIRES_APPROVAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'MAPPING', 'VALIDATING', 'VALIDATED', 'APPROVED', 'EXECUTING', 'COMPLETED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'VALID', 'INVALID', 'DUPLICATE', 'IMPORTED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "DuplicateResolution" AS ENUM ('CREATE_NEW', 'LINK_EXISTING', 'MERGE', 'REJECT_ROW', 'DEFER_REVIEW');

-- AlterTable
ALTER TABLE "Drug" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "coldChain" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "combinedSearchText" TEXT,
ADD COLUMN     "controlledDrug" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "countryOfOriginId" TEXT,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "dataQualityStatus" "DataQualityStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
ADD COLUMN     "discontinuationDate" TIMESTAMP(3),
ADD COLUMN     "discontinuationReason" TEXT,
ADD COLUMN     "discontinued" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dosageFormId" TEXT,
ADD COLUMN     "manufacturerId" TEXT,
ADD COLUMN     "mergedIntoDrugId" TEXT,
ADD COLUMN     "normalizedTradeNameArabic" TEXT,
ADD COLUMN     "normalizedTradeNameEnglish" TEXT,
ADD COLUMN     "regulatoryCategory" TEXT,
ADD COLUMN     "requiresPrescription" BOOLEAN,
ADD COLUMN     "requiresSpecialHandling" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "searchNameArabic" TEXT,
ADD COLUMN     "searchNameEnglish" TEXT,
ADD COLUMN     "sourceRecordId" TEXT,
ADD COLUMN     "sourceSystem" TEXT,
ADD COLUMN     "strengthText" TEXT,
ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DrugCoverage" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "coverageNotes" TEXT,
ADD COLUMN     "coverageStatus" "CoverageStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "effectiveFrom" TIMESTAMP(3),
ADD COLUMN     "effectiveTo" TIMESTAMP(3),
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sourceSystem" TEXT;

-- Backfill: coverageStatus is new and defaults to UNKNOWN for the column
-- add above, but every existing DrugCoverage row already has a real
-- `covered` boolean answer — reflect that instead of leaving thousands of
-- real coverage rows reporting UNKNOWN (design doc §11 "Do not treat
-- stale coverage data as current" — this is the opposite case, current
-- data, so it should say so).
UPDATE "DrugCoverage" SET "coverageStatus" = CASE WHEN "covered" THEN 'COVERED' ELSE 'NOT_COVERED' END::"CoverageStatus";

-- AlterTable
ALTER TABLE "InsuranceCompany" ADD COLUMN     "providerType" TEXT;

-- AlterTable
ALTER TABLE "OCRTextBlock" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Country" (
    "id" TEXT NOT NULL,
    "isoCode" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT,
    "normalizedNameEn" TEXT NOT NULL,
    "normalizedNameAr" TEXT,
    "countryId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sourceSystem" TEXT,
    "sourceRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DosageForm" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "normalizedNameEn" TEXT NOT NULL,
    "normalizedNameAr" TEXT NOT NULL,
    "synonymsJson" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DosageForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementUnit" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "unitCategory" TEXT NOT NULL,
    "normalizationFactor" DECIMAL(18,6),
    "baseUnitCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MeasurementUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActiveIngredient" (
    "id" TEXT NOT NULL,
    "scientificNameEn" TEXT NOT NULL,
    "scientificNameAr" TEXT,
    "normalizedScientificNameEn" TEXT NOT NULL,
    "normalizedScientificNameAr" TEXT,
    "searchNameEn" TEXT NOT NULL,
    "searchNameAr" TEXT,
    "abbreviation" TEXT,
    "atcCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "updatedById" TEXT,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugIngredient" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "activeIngredientId" TEXT NOT NULL,
    "ingredientStrength" TEXT,
    "ingredientStrengthNumeric" DECIMAL(18,6),
    "ingredientUnitId" TEXT,
    "concentrationText" TEXT,
    "ingredientRole" "IngredientRole" NOT NULL DEFAULT 'PRIMARY',
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DrugIngredient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugStrengthComponent" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "activeIngredientId" TEXT,
    "numeratorValue" DECIMAL(18,6),
    "numeratorUnitId" TEXT,
    "denominatorValue" DECIMAL(18,6),
    "denominatorUnitId" TEXT,
    "originalStrengthText" TEXT NOT NULL,
    "normalizedStrengthText" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DrugStrengthComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugPackage" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "packageType" TEXT NOT NULL,
    "packSize" DECIMAL(18,3),
    "packUnitId" TEXT,
    "unitsPerPackage" INTEGER,
    "packagingDescriptionEn" TEXT,
    "packagingDescriptionAr" TEXT,
    "barcode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DrugPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TherapeuticClass" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "parentId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TherapeuticClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugTherapeuticClass" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "therapeuticClassId" TEXT NOT NULL,
    "primary" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "DrugTherapeuticClass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugAlias" (
    "id" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "script" TEXT,
    "aliasType" "AliasType" NOT NULL,
    "source" "AliasSource" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugAlternativeLink" (
    "id" TEXT NOT NULL,
    "sourceDrugId" TEXT NOT NULL,
    "alternativeDrugId" TEXT NOT NULL,
    "alternativeType" "DrugAlternativeType" NOT NULL,
    "equivalenceLevel" TEXT,
    "sameActiveIngredient" BOOLEAN NOT NULL DEFAULT false,
    "sameStrength" BOOLEAN NOT NULL DEFAULT false,
    "sameDosageForm" BOOLEAN NOT NULL DEFAULT false,
    "pharmacistApproved" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DrugAlternativeLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "mappingJson" JSONB,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rolledBackById" TEXT,
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DrugImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrugImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawDataJson" JSONB NOT NULL,
    "normalizedDataJson" JSONB,
    "validationErrorsJson" JSONB,
    "duplicateCandidatesJson" JSONB,
    "resolution" "DuplicateResolution",
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "linkedDrugId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrugImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Country_isoCode_key" ON "Country"("isoCode");

-- CreateIndex
CREATE INDEX "Country_active_idx" ON "Country"("active");

-- CreateIndex
CREATE INDEX "Manufacturer_normalizedNameEn_idx" ON "Manufacturer"("normalizedNameEn");

-- CreateIndex
CREATE INDEX "Manufacturer_active_idx" ON "Manufacturer"("active");

-- CreateIndex
CREATE UNIQUE INDEX "DosageForm_code_key" ON "DosageForm"("code");

-- CreateIndex
CREATE INDEX "DosageForm_active_idx" ON "DosageForm"("active");

-- CreateIndex
CREATE UNIQUE INDEX "MeasurementUnit_code_key" ON "MeasurementUnit"("code");

-- CreateIndex
CREATE INDEX "MeasurementUnit_active_idx" ON "MeasurementUnit"("active");

-- CreateIndex
CREATE INDEX "ActiveIngredient_normalizedScientificNameEn_idx" ON "ActiveIngredient"("normalizedScientificNameEn");

-- CreateIndex
CREATE INDEX "ActiveIngredient_atcCode_idx" ON "ActiveIngredient"("atcCode");

-- CreateIndex
CREATE INDEX "ActiveIngredient_active_idx" ON "ActiveIngredient"("active");

-- CreateIndex
CREATE INDEX "DrugIngredient_drugId_idx" ON "DrugIngredient"("drugId");

-- CreateIndex
CREATE INDEX "DrugIngredient_activeIngredientId_idx" ON "DrugIngredient"("activeIngredientId");

-- CreateIndex
CREATE UNIQUE INDEX "DrugIngredient_drugId_activeIngredientId_key" ON "DrugIngredient"("drugId", "activeIngredientId");

-- CreateIndex
CREATE INDEX "DrugStrengthComponent_drugId_idx" ON "DrugStrengthComponent"("drugId");

-- CreateIndex
CREATE INDEX "DrugPackage_drugId_idx" ON "DrugPackage"("drugId");

-- CreateIndex
CREATE INDEX "DrugPackage_barcode_idx" ON "DrugPackage"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "TherapeuticClass_code_key" ON "TherapeuticClass"("code");

-- CreateIndex
CREATE INDEX "TherapeuticClass_parentId_idx" ON "TherapeuticClass"("parentId");

-- CreateIndex
CREATE INDEX "DrugTherapeuticClass_drugId_idx" ON "DrugTherapeuticClass"("drugId");

-- CreateIndex
CREATE UNIQUE INDEX "DrugTherapeuticClass_drugId_therapeuticClassId_key" ON "DrugTherapeuticClass"("drugId", "therapeuticClassId");

-- CreateIndex
CREATE INDEX "DrugAlias_normalizedAlias_idx" ON "DrugAlias"("normalizedAlias");

-- CreateIndex
CREATE INDEX "DrugAlias_drugId_idx" ON "DrugAlias"("drugId");

-- CreateIndex
CREATE INDEX "DrugAlias_approved_idx" ON "DrugAlias"("approved");

-- CreateIndex
CREATE UNIQUE INDEX "DrugAlias_drugId_normalizedAlias_key" ON "DrugAlias"("drugId", "normalizedAlias");

-- CreateIndex
CREATE INDEX "DrugAlternativeLink_sourceDrugId_idx" ON "DrugAlternativeLink"("sourceDrugId");

-- CreateIndex
CREATE INDEX "DrugAlternativeLink_pharmacistApproved_idx" ON "DrugAlternativeLink"("pharmacistApproved");

-- CreateIndex
CREATE UNIQUE INDEX "DrugAlternativeLink_sourceDrugId_alternativeDrugId_key" ON "DrugAlternativeLink"("sourceDrugId", "alternativeDrugId");

-- CreateIndex
CREATE INDEX "DrugImportBatch_status_createdAt_idx" ON "DrugImportBatch"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DrugImportRow_batchId_idx" ON "DrugImportRow"("batchId");

-- CreateIndex
CREATE INDEX "DrugImportRow_status_idx" ON "DrugImportRow"("status");

-- CreateIndex
CREATE INDEX "Drug_barcode_idx" ON "Drug"("barcode");

-- CreateIndex
CREATE INDEX "Drug_dataQualityStatus_idx" ON "Drug"("dataQualityStatus");

-- CreateIndex
CREATE INDEX "Drug_active_discontinued_idx" ON "Drug"("active", "discontinued");

-- CreateIndex
CREATE INDEX "Drug_manufacturerId_idx" ON "Drug"("manufacturerId");

-- CreateIndex
CREATE INDEX "Drug_dosageFormId_idx" ON "Drug"("dosageFormId");

-- CreateIndex
CREATE INDEX "DrugCoverage_coverageStatus_idx" ON "DrugCoverage"("coverageStatus");

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_dosageFormId_fkey" FOREIGN KEY ("dosageFormId") REFERENCES "DosageForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_countryOfOriginId_fkey" FOREIGN KEY ("countryOfOriginId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Drug" ADD CONSTRAINT "Drug_mergedIntoDrugId_fkey" FOREIGN KEY ("mergedIntoDrugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Manufacturer" ADD CONSTRAINT "Manufacturer_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugIngredient" ADD CONSTRAINT "DrugIngredient_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugIngredient" ADD CONSTRAINT "DrugIngredient_activeIngredientId_fkey" FOREIGN KEY ("activeIngredientId") REFERENCES "ActiveIngredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugIngredient" ADD CONSTRAINT "DrugIngredient_ingredientUnitId_fkey" FOREIGN KEY ("ingredientUnitId") REFERENCES "MeasurementUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugStrengthComponent" ADD CONSTRAINT "DrugStrengthComponent_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugStrengthComponent" ADD CONSTRAINT "DrugStrengthComponent_activeIngredientId_fkey" FOREIGN KEY ("activeIngredientId") REFERENCES "ActiveIngredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugStrengthComponent" ADD CONSTRAINT "DrugStrengthComponent_numeratorUnitId_fkey" FOREIGN KEY ("numeratorUnitId") REFERENCES "MeasurementUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugStrengthComponent" ADD CONSTRAINT "DrugStrengthComponent_denominatorUnitId_fkey" FOREIGN KEY ("denominatorUnitId") REFERENCES "MeasurementUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugPackage" ADD CONSTRAINT "DrugPackage_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugPackage" ADD CONSTRAINT "DrugPackage_packUnitId_fkey" FOREIGN KEY ("packUnitId") REFERENCES "MeasurementUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TherapeuticClass" ADD CONSTRAINT "TherapeuticClass_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TherapeuticClass"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugTherapeuticClass" ADD CONSTRAINT "DrugTherapeuticClass_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugTherapeuticClass" ADD CONSTRAINT "DrugTherapeuticClass_therapeuticClassId_fkey" FOREIGN KEY ("therapeuticClassId") REFERENCES "TherapeuticClass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugAlias" ADD CONSTRAINT "DrugAlias_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugAlternativeLink" ADD CONSTRAINT "DrugAlternativeLink_sourceDrugId_fkey" FOREIGN KEY ("sourceDrugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugAlternativeLink" ADD CONSTRAINT "DrugAlternativeLink_alternativeDrugId_fkey" FOREIGN KEY ("alternativeDrugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugImportRow" ADD CONSTRAINT "DrugImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "DrugImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrugImportRow" ADD CONSTRAINT "DrugImportRow_linkedDrugId_fkey" FOREIGN KEY ("linkedDrugId") REFERENCES "Drug"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Trigram GIN indexes (design doc §15/§26) — fuzzy Arabic/English
-- matching on the new normalized search columns. Hand-added: Prisma's
-- schema DSL has no gin_trgm_ops opclass syntax.
CREATE INDEX "Drug_normalizedTradeNameEnglish_trgm_idx" ON "Drug" USING GIN ("normalizedTradeNameEnglish" gin_trgm_ops);
CREATE INDEX "Drug_normalizedTradeNameArabic_trgm_idx" ON "Drug" USING GIN ("normalizedTradeNameArabic" gin_trgm_ops);
CREATE INDEX "Drug_searchNameEnglish_trgm_idx" ON "Drug" USING GIN ("searchNameEnglish" gin_trgm_ops);
CREATE INDEX "Drug_searchNameArabic_trgm_idx" ON "Drug" USING GIN ("searchNameArabic" gin_trgm_ops);
CREATE INDEX "Drug_combinedSearchText_trgm_idx" ON "Drug" USING GIN ("combinedSearchText" gin_trgm_ops);
CREATE INDEX "DrugAlias_normalizedAlias_trgm_idx" ON "DrugAlias" USING GIN ("normalizedAlias" gin_trgm_ops);
CREATE INDEX "ActiveIngredient_normalizedScientificNameEn_trgm_idx" ON "ActiveIngredient" USING GIN ("normalizedScientificNameEn" gin_trgm_ops);
CREATE INDEX "Manufacturer_normalizedNameEn_trgm_idx" ON "Manufacturer" USING GIN ("normalizedNameEn" gin_trgm_ops);
