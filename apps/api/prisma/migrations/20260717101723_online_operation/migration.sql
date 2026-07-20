-- CreateEnum
CREATE TYPE "IntegrationOpStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'DEAD');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "requestSourceKey" TEXT;

-- CreateTable
CREATE TABLE "OrderSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "OrderSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestSource" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RequestSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineOrder" (
    "id" TEXT NOT NULL,
    "externalNumber" TEXT NOT NULL,
    "orderSourceKey" TEXT NOT NULL,
    "orderedAt" TIMESTAMP(3) NOT NULL,
    "customerName" TEXT,
    "customerPhone" TEXT,
    "value" DECIMAL(14,2),
    "externalStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationOperation" (
    "id" TEXT NOT NULL,
    "integrationKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "IntegrationOpStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "succeededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderSource_key_key" ON "OrderSource"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RequestSource_key_key" ON "RequestSource"("key");

-- CreateIndex
CREATE UNIQUE INDEX "OnlineOrder_externalNumber_key" ON "OnlineOrder"("externalNumber");

-- CreateIndex
CREATE INDEX "OnlineOrder_orderedAt_idx" ON "OnlineOrder"("orderedAt");

-- CreateIndex
CREATE INDEX "OnlineOrder_orderSourceKey_orderedAt_idx" ON "OnlineOrder"("orderSourceKey", "orderedAt");

-- CreateIndex
CREATE INDEX "IntegrationOperation_status_nextRetryAt_idx" ON "IntegrationOperation"("status", "nextRetryAt");

-- CreateIndex
CREATE INDEX "IntegrationOperation_integrationKey_createdAt_idx" ON "IntegrationOperation"("integrationKey", "createdAt");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_requestSourceKey_fkey" FOREIGN KEY ("requestSourceKey") REFERENCES "RequestSource"("key") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnlineOrder" ADD CONSTRAINT "OnlineOrder_orderSourceKey_fkey" FOREIGN KEY ("orderSourceKey") REFERENCES "OrderSource"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
