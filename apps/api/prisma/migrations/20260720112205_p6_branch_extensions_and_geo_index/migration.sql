-- Phase 6 (2/8) — Branch operational extensions (working hours, special
-- hours, service areas, capabilities), operational-eligibility flags on
-- Branch, and the earthdistance/cube-backed geospatial index that
-- upgrades the locator away from a full-table JS Haversine scan.
--
-- NOTE: `prisma migrate diff` also proposed dropping/recreating 8
-- pg_trgm indexes from the Phase 4 migration (hand-written, not
-- expressible in Prisma's schema DSL, so the diff tool treats them as
-- unsatisfied). Those DROP/CREATE INDEX statements are intentionally
-- omitted — false positives, not part of this phase's change. Same
-- discipline as the Phase 6 Step 1 migration.

-- earthdistance/cube (bundled with the same contrib package as
-- pg_trgm, already installed in this environment) — GiST-indexed
-- radius and nearest-neighbor queries without requiring PostGIS.
-- Step 1's decision record: PostGIS is the eventual target for
-- polygon service areas; this is the interim, already-available path.
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS earthdistance;

-- CreateEnum
CREATE TYPE "ServiceAreaType" AS ENUM ('CITY', 'DISTRICT', 'RADIUS', 'POLYGON', 'POSTAL_CODE', 'MANUAL_ZONE');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "maximumDailyOrders" INTEGER,
ADD COLUMN     "pickupEnabled" BOOLEAN DEFAULT true,
ADD COLUMN     "preparationCapacityPerHour" INTEGER,
ADD COLUMN     "prescriptionFulfillmentEnabled" BOOLEAN DEFAULT false,
ADD COLUMN     "temporarilyClosed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "temporarilyClosedReason" TEXT;

-- CreateTable
CREATE TABLE "BranchWorkingHours" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "opensAt" TEXT,
    "closesAt" TEXT,
    "secondShiftOpensAt" TEXT,
    "secondShiftClosesAt" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchWorkingHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchSpecialHours" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "opensAt" TEXT,
    "closesAt" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchSpecialHours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchServiceArea" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "serviceAreaType" "ServiceAreaType" NOT NULL,
    "cityId" TEXT,
    "districtId" TEXT,
    "radiusKm" DOUBLE PRECISION,
    "centerLatitude" DOUBLE PRECISION,
    "centerLongitude" DOUBLE PRECISION,
    "polygonGeoJson" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pickupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minimumOrderValue" DOUBLE PRECISION,
    "maximumDeliveryDistanceKm" DOUBLE PRECISION,
    "estimatedDeliveryMinutes" INTEGER,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchServiceArea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchCapability" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchCapabilityAssignment" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BranchCapabilityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchWorkingHours_branchId_dayOfWeek_idx" ON "BranchWorkingHours"("branchId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "BranchSpecialHours_branchId_idx" ON "BranchSpecialHours"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchSpecialHours_branchId_date_key" ON "BranchSpecialHours"("branchId", "date");

-- CreateIndex
CREATE INDEX "BranchServiceArea_branchId_idx" ON "BranchServiceArea"("branchId");

-- CreateIndex
CREATE INDEX "BranchServiceArea_cityId_idx" ON "BranchServiceArea"("cityId");

-- CreateIndex
CREATE INDEX "BranchServiceArea_districtId_idx" ON "BranchServiceArea"("districtId");

-- CreateIndex
CREATE INDEX "BranchServiceArea_serviceAreaType_idx" ON "BranchServiceArea"("serviceAreaType");

-- CreateIndex
CREATE UNIQUE INDEX "BranchCapability_code_key" ON "BranchCapability"("code");

-- CreateIndex
CREATE INDEX "BranchCapabilityAssignment_branchId_idx" ON "BranchCapabilityAssignment"("branchId");

-- CreateIndex
CREATE INDEX "BranchCapabilityAssignment_capabilityId_idx" ON "BranchCapabilityAssignment"("capabilityId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchCapabilityAssignment_branchId_capabilityId_key" ON "BranchCapabilityAssignment"("branchId", "capabilityId");

-- AddForeignKey
ALTER TABLE "BranchWorkingHours" ADD CONSTRAINT "BranchWorkingHours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchSpecialHours" ADD CONSTRAINT "BranchSpecialHours_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchServiceArea" ADD CONSTRAINT "BranchServiceArea_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchServiceArea" ADD CONSTRAINT "BranchServiceArea_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchServiceArea" ADD CONSTRAINT "BranchServiceArea_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCapabilityAssignment" ADD CONSTRAINT "BranchCapabilityAssignment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchCapabilityAssignment" ADD CONSTRAINT "BranchCapabilityAssignment_capabilityId_fkey" FOREIGN KEY ("capabilityId") REFERENCES "BranchCapability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- GiST index over ll_to_earth(latitude, longitude) for nearest-neighbor
-- queries via earth_distance/earth_box (Prisma's DSL has no opclass
-- syntax, same as Phase 4's gin_trgm_ops indexes — hand-written).
-- Partial index: only branches with real coordinates participate.
CREATE INDEX "Branch_earth_point_idx" ON "Branch" USING gist (ll_to_earth("latitude", "longitude"))
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
