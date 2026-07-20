-- Phase 6 Step 6 — InventoryReservation data foundation (spec §26).
-- NOTE: `prisma migrate diff` also proposed DROP/CREATE INDEX statements
-- for 8 hand-written pg_trgm GIN indexes from Phase 4 (not expressible in
-- Prisma's schema DSL) — those are intentionally omitted here, same as
-- every migration since Phase 4.

-- CreateEnum
CREATE TYPE "InventoryReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PARTIALLY_FULFILLED', 'FULFILLED', 'EXPIRED', 'CANCELLED', 'RELEASED', 'FAILED');

-- AlterTable
ALTER TABLE "FulfillmentPlan" ADD COLUMN     "selectedAt" TIMESTAMP(3),
ADD COLUMN     "selectedById" TEXT;

-- CreateTable
CREATE TABLE "InventoryReservation" (
    "id" TEXT NOT NULL,
    "fulfillmentPlanId" TEXT NOT NULL,
    "fulfillmentPlanItemId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "drugId" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "status" "InventoryReservationStatus" NOT NULL DEFAULT 'PENDING',
    "reservedById" TEXT,
    "reservedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryReservation_fulfillmentPlanId_idx" ON "InventoryReservation"("fulfillmentPlanId");

-- CreateIndex
CREATE INDEX "InventoryReservation_branchId_idx" ON "InventoryReservation"("branchId");

-- CreateIndex
CREATE INDEX "InventoryReservation_drugId_idx" ON "InventoryReservation"("drugId");

-- CreateIndex
CREATE INDEX "InventoryReservation_status_idx" ON "InventoryReservation"("status");

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_fulfillmentPlanId_fkey" FOREIGN KEY ("fulfillmentPlanId") REFERENCES "FulfillmentPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_fulfillmentPlanItemId_fkey" FOREIGN KEY ("fulfillmentPlanItemId") REFERENCES "FulfillmentPlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_drugId_fkey" FOREIGN KEY ("drugId") REFERENCES "Drug"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
