-- Phase 6 (4/8) — Fulfillment Engine schema: SearchLocation,
-- FulfillmentRequest/Item, FulfillmentPlan/Branch/Item. Additive only.
--
-- NOTE: `prisma migrate diff` also proposed dropping/recreating 8
-- pg_trgm indexes from the Phase 4 migration (hand-written, not
-- expressible in Prisma's schema DSL). Intentionally omitted — same
-- false-positive as every prior Phase 6 migration.

-- CreateEnum
CREATE TYPE "SearchLocationSourceType" AS ENUM ('MANUAL_CITY', 'MANUAL_DISTRICT', 'FREE_TEXT_ADDRESS', 'MAP_PIN', 'DEVICE_GEOLOCATION', 'SAVED_ADDRESS', 'PARTNER_API', 'IMPORTED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FulfillmentMode" AS ENUM ('DELIVERY', 'PICKUP', 'EITHER', 'INTERNAL_TRANSFER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "FulfillmentRequestStatus" AS ENUM ('DRAFT', 'LOCATION_REQUIRED', 'SEARCH_QUEUED', 'SEARCHING', 'OPTIONS_FOUND', 'PARTIAL_OPTIONS_FOUND', 'NO_OPTIONS_FOUND', 'REVIEW_REQUIRED', 'PLAN_SELECTED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "FulfillmentPlanType" AS ENUM ('SINGLE_BRANCH', 'SPLIT_BRANCH', 'PICKUP', 'DELIVERY', 'MIXED_MODE', 'NO_SAFE_PLAN');

-- CreateEnum
CREATE TYPE "PlanItemAvailabilityStatus" AS ENUM ('AVAILABLE', 'PARTIAL', 'UNAVAILABLE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "SearchLocation" (
    "id" TEXT NOT NULL,
    "cityId" TEXT,
    "districtId" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "addressText" TEXT,
    "normalizedAddressText" TEXT,
    "postalCode" TEXT,
    "sourceType" "SearchLocationSourceType" NOT NULL,
    "geocodingStatus" TEXT,
    "geocodingConfidence" DOUBLE PRECISION,
    "userConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentRequest" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "searchLocationId" TEXT,
    "requestedFulfillmentMode" "FulfillmentMode" NOT NULL DEFAULT 'UNKNOWN',
    "requestedDeliveryWindowStart" TIMESTAMP(3),
    "requestedDeliveryWindowEnd" TIMESTAMP(3),
    "status" "FulfillmentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "initiatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FulfillmentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentRequestItem" (
    "id" TEXT NOT NULL,
    "fulfillmentRequestId" TEXT NOT NULL,
    "medicationLineId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "requiredQuantity" DOUBLE PRECISION,
    "quantityUnit" TEXT,
    "quantityConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "specialHandlingRequired" BOOLEAN NOT NULL DEFAULT false,
    "coldChainRequired" BOOLEAN NOT NULL DEFAULT false,
    "controlledDrug" BOOLEAN NOT NULL DEFAULT false,
    "substitutionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FulfillmentRequestItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentPlan" (
    "id" TEXT NOT NULL,
    "fulfillmentRequestId" TEXT NOT NULL,
    "planType" "FulfillmentPlanType" NOT NULL,
    "rank" INTEGER NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "branchCount" INTEGER NOT NULL,
    "completeCoverage" BOOLEAN NOT NULL,
    "totalDistanceKm" DOUBLE PRECISION,
    "estimatedPreparationMinutes" INTEGER,
    "estimatedDeliveryMinutes" INTEGER,
    "stockFreshnessStatus" TEXT,
    "explanationJson" JSONB,
    "conflictsJson" JSONB,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentPlanBranch" (
    "id" TEXT NOT NULL,
    "fulfillmentPlanId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION,
    "estimatedTravelMinutes" INTEGER,
    "estimatedPreparationMinutes" INTEGER,
    "operatingStatus" TEXT,
    "serviceabilityStatus" TEXT,
    "stockVerificationStatus" TEXT,
    "score" DOUBLE PRECISION,
    "explanationJson" JSONB,

    CONSTRAINT "FulfillmentPlanBranch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FulfillmentPlanItem" (
    "id" TEXT NOT NULL,
    "fulfillmentPlanBranchId" TEXT NOT NULL,
    "fulfillmentRequestItemId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "requestedQuantity" DOUBLE PRECISION,
    "availableQuantity" DOUBLE PRECISION,
    "allocatedQuantity" DOUBLE PRECISION,
    "availabilityStatus" "PlanItemAvailabilityStatus" NOT NULL DEFAULT 'UNKNOWN',
    "freshnessStatus" TEXT,
    "sourceTimestamp" TIMESTAMP(3),

    CONSTRAINT "FulfillmentPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SearchLocation_cityId_idx" ON "SearchLocation"("cityId");

-- CreateIndex
CREATE INDEX "SearchLocation_districtId_idx" ON "SearchLocation"("districtId");

-- CreateIndex
CREATE INDEX "FulfillmentRequest_prescriptionId_idx" ON "FulfillmentRequest"("prescriptionId");

-- CreateIndex
CREATE INDEX "FulfillmentRequest_status_idx" ON "FulfillmentRequest"("status");

-- CreateIndex
CREATE INDEX "FulfillmentRequestItem_fulfillmentRequestId_idx" ON "FulfillmentRequestItem"("fulfillmentRequestId");

-- CreateIndex
CREATE INDEX "FulfillmentRequestItem_medicationLineId_idx" ON "FulfillmentRequestItem"("medicationLineId");

-- CreateIndex
CREATE INDEX "FulfillmentRequestItem_drugId_idx" ON "FulfillmentRequestItem"("drugId");

-- CreateIndex
CREATE INDEX "FulfillmentPlan_fulfillmentRequestId_idx" ON "FulfillmentPlan"("fulfillmentRequestId");

-- CreateIndex
CREATE INDEX "FulfillmentPlan_rank_idx" ON "FulfillmentPlan"("rank");

-- CreateIndex
CREATE INDEX "FulfillmentPlanBranch_fulfillmentPlanId_idx" ON "FulfillmentPlanBranch"("fulfillmentPlanId");

-- CreateIndex
CREATE INDEX "FulfillmentPlanBranch_branchId_idx" ON "FulfillmentPlanBranch"("branchId");

-- CreateIndex
CREATE INDEX "FulfillmentPlanItem_fulfillmentPlanBranchId_idx" ON "FulfillmentPlanItem"("fulfillmentPlanBranchId");

-- CreateIndex
CREATE INDEX "FulfillmentPlanItem_fulfillmentRequestItemId_idx" ON "FulfillmentPlanItem"("fulfillmentRequestItemId");

-- CreateIndex
CREATE INDEX "FulfillmentPlanItem_drugId_idx" ON "FulfillmentPlanItem"("drugId");

-- AddForeignKey
ALTER TABLE "SearchLocation" ADD CONSTRAINT "SearchLocation_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchLocation" ADD CONSTRAINT "SearchLocation_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequest" ADD CONSTRAINT "FulfillmentRequest_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequest" ADD CONSTRAINT "FulfillmentRequest_searchLocationId_fkey" FOREIGN KEY ("searchLocationId") REFERENCES "SearchLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestItem" ADD CONSTRAINT "FulfillmentRequestItem_fulfillmentRequestId_fkey" FOREIGN KEY ("fulfillmentRequestId") REFERENCES "FulfillmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestItem" ADD CONSTRAINT "FulfillmentRequestItem_medicationLineId_fkey" FOREIGN KEY ("medicationLineId") REFERENCES "PrescriptionMedicationLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentRequestItem" ADD CONSTRAINT "FulfillmentRequestItem_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlan" ADD CONSTRAINT "FulfillmentPlan_fulfillmentRequestId_fkey" FOREIGN KEY ("fulfillmentRequestId") REFERENCES "FulfillmentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlanBranch" ADD CONSTRAINT "FulfillmentPlanBranch_fulfillmentPlanId_fkey" FOREIGN KEY ("fulfillmentPlanId") REFERENCES "FulfillmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlanBranch" ADD CONSTRAINT "FulfillmentPlanBranch_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlanItem" ADD CONSTRAINT "FulfillmentPlanItem_fulfillmentPlanBranchId_fkey" FOREIGN KEY ("fulfillmentPlanBranchId") REFERENCES "FulfillmentPlanBranch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlanItem" ADD CONSTRAINT "FulfillmentPlanItem_fulfillmentRequestItemId_fkey" FOREIGN KEY ("fulfillmentRequestItemId") REFERENCES "FulfillmentRequestItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfillmentPlanItem" ADD CONSTRAINT "FulfillmentPlanItem_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
