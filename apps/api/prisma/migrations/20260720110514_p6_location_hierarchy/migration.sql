-- Phase 6 (1/8) — Location-Aware Branch Inventory & Fulfillment Engine:
-- location hierarchy (Region → City → District), LocationAlias, and
-- additive Branch pointers into it. Everything here is a new table or
-- an additive nullable/defaulted column — no existing Branch column is
-- touched, dropped, or renamed.
--
-- NOTE: `prisma migrate diff` also proposed dropping/recreating 8
-- pg_trgm indexes from the Phase 4 migration (they're hand-written
-- `USING gin (... gin_trgm_ops)` indexes that Prisma's schema DSL can't
-- express, so the diff tool doesn't see them as already satisfied).
-- Those DROP/CREATE INDEX statements are intentionally omitted here —
-- they are false positives, not part of this phase's change.

-- CreateEnum
CREATE TYPE "LocationAliasEntityType" AS ENUM ('CITY', 'DISTRICT');

-- CreateEnum
CREATE TYPE "BranchLocationMatchStatus" AS ENUM ('UNRESOLVED', 'AUTO_MATCHED', 'NEEDS_REVIEW', 'MANUALLY_CONFIRMED');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "locationCityId" TEXT,
ADD COLUMN     "locationDistrictId" TEXT,
ADD COLUMN     "locationMatchStatus" "BranchLocationMatchStatus" NOT NULL DEFAULT 'UNRESOLVED';

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "normalizedNameEn" TEXT NOT NULL,
    "normalizedNameAr" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "timezone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "normalizedNameEn" TEXT NOT NULL,
    "normalizedNameAr" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationAlias" (
    "id" TEXT NOT NULL,
    "entityType" "LocationAliasEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE INDEX "Region_active_idx" ON "Region"("active");

-- CreateIndex
CREATE UNIQUE INDEX "City_code_key" ON "City"("code");

-- CreateIndex
CREATE INDEX "City_regionId_idx" ON "City"("regionId");

-- CreateIndex
CREATE INDEX "City_normalizedNameEn_idx" ON "City"("normalizedNameEn");

-- CreateIndex
CREATE INDEX "City_normalizedNameAr_idx" ON "City"("normalizedNameAr");

-- CreateIndex
CREATE INDEX "City_active_idx" ON "City"("active");

-- CreateIndex
CREATE UNIQUE INDEX "District_code_key" ON "District"("code");

-- CreateIndex
CREATE INDEX "District_cityId_idx" ON "District"("cityId");

-- CreateIndex
CREATE INDEX "District_normalizedNameEn_idx" ON "District"("normalizedNameEn");

-- CreateIndex
CREATE INDEX "District_normalizedNameAr_idx" ON "District"("normalizedNameAr");

-- CreateIndex
CREATE INDEX "District_active_idx" ON "District"("active");

-- CreateIndex
CREATE INDEX "LocationAlias_normalizedAlias_idx" ON "LocationAlias"("normalizedAlias");

-- CreateIndex
CREATE INDEX "LocationAlias_entityType_entityId_idx" ON "LocationAlias"("entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationAlias_entityType_entityId_normalizedAlias_language_key" ON "LocationAlias"("entityType", "entityId", "normalizedAlias", "language");

-- CreateIndex
CREATE INDEX "Branch_locationCityId_idx" ON "Branch"("locationCityId");

-- CreateIndex
CREATE INDEX "Branch_locationDistrictId_idx" ON "Branch"("locationDistrictId");

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_locationCityId_fkey" FOREIGN KEY ("locationCityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_locationDistrictId_fkey" FOREIGN KEY ("locationDistrictId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "City" ADD CONSTRAINT "City_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
