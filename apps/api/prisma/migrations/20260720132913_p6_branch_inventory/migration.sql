-- Phase 6 (3/8) — BranchInventory: the sole source of truth for the
-- fulfillment engine's stock checks. Additive; the legacy
-- Drug.availability {city: qty} Json field is untouched.
--
-- NOTE: `prisma migrate diff` also proposed dropping/recreating 8
-- pg_trgm indexes from the Phase 4 migration (hand-written, not
-- expressible in Prisma's schema DSL). Intentionally omitted — same
-- false-positive as every prior Phase 6 migration.

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'BLOCKED', 'UNKNOWN', 'STALE', 'IN_TRANSIT', 'DISCONTINUED');

-- CreateTable
CREATE TABLE "BranchInventory" (
    "id" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "sapMaterialNumber" TEXT NOT NULL,
    "onHandQuantity" DOUBLE PRECISION,
    "availableQuantity" DOUBLE PRECISION,
    "reservedQuantity" DOUBLE PRECISION,
    "blockedQuantity" DOUBLE PRECISION,
    "damagedQuantity" DOUBLE PRECISION,
    "inTransitQuantity" DOUBLE PRECISION,
    "safetyStockQuantity" DOUBLE PRECISION,
    "expectedRestockQuantity" DOUBLE PRECISION,
    "expectedRestockAt" TIMESTAMP(3),
    "batchCount" INTEGER,
    "earliestExpiryDate" TIMESTAMP(3),
    "inventoryStatus" "InventoryStatus" NOT NULL DEFAULT 'UNKNOWN',
    "sourceSystem" TEXT,
    "sourceTimestamp" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchInventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BranchInventory_branchId_idx" ON "BranchInventory"("branchId");

-- CreateIndex
CREATE INDEX "BranchInventory_drugId_idx" ON "BranchInventory"("drugId");

-- CreateIndex
CREATE INDEX "BranchInventory_sapMaterialNumber_idx" ON "BranchInventory"("sapMaterialNumber");

-- CreateIndex
CREATE INDEX "BranchInventory_inventoryStatus_idx" ON "BranchInventory"("inventoryStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BranchInventory_branchId_drugId_key" ON "BranchInventory"("branchId", "drugId");

-- AddForeignKey
ALTER TABLE "BranchInventory" ADD CONSTRAINT "BranchInventory_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchInventory" ADD CONSTRAINT "BranchInventory_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE CASCADE ON UPDATE CASCADE;
