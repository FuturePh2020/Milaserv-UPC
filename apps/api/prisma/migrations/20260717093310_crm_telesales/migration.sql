-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'ASSIGNED', 'CLOSED');

-- CreateEnum
CREATE TYPE "TelesalesOrderStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "MetricSource" ADD VALUE 'TELESALES';

-- CreateTable
CREATE TABLE "CallStatus" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CallStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadDisposition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "closesLead" BOOLEAN NOT NULL DEFAULT false,
    "requiresReschedule" BOOLEAN NOT NULL DEFAULT false,
    "createsOrder" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LeadDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelesalesOrderType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "nameEn" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TelesalesOrderType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "leadSource" TEXT NOT NULL,
    "partnerName" TEXT,
    "campaign" TEXT,
    "uploadedById" TEXT NOT NULL,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "notes" TEXT,
    "leadSource" TEXT NOT NULL,
    "partnerName" TEXT,
    "campaign" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "assignedToId" TEXT,
    "assignedAt" TIMESTAMP(3),
    "rescheduledAt" TIMESTAMP(3),
    "lastCallAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedDispositionKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCall" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "callStatusKey" TEXT NOT NULL,
    "dispositionKey" TEXT NOT NULL,
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "rescheduledAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelesalesOrder" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "leadId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "orderTypeKey" TEXT NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "status" "TelesalesOrderStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelesalesOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CallStatus_key_key" ON "CallStatus"("key");

-- CreateIndex
CREATE UNIQUE INDEX "LeadDisposition_key_key" ON "LeadDisposition"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TelesalesOrderType_key_key" ON "TelesalesOrderType"("key");

-- CreateIndex
CREATE INDEX "Lead_status_rescheduledAt_idx" ON "Lead"("status", "rescheduledAt");

-- CreateIndex
CREATE INDEX "Lead_assignedToId_status_idx" ON "Lead"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "Lead_phone_idx" ON "Lead"("phone");

-- CreateIndex
CREATE INDEX "LeadCall_agentId_createdAt_idx" ON "LeadCall"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadCall_leadId_createdAt_idx" ON "LeadCall"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelesalesOrder_number_key" ON "TelesalesOrder"("number");

-- CreateIndex
CREATE INDEX "TelesalesOrder_createdById_createdAt_idx" ON "TelesalesOrder"("createdById", "createdAt");

-- CreateIndex
CREATE INDEX "TelesalesOrder_status_createdAt_idx" ON "TelesalesOrder"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "LeadBatch" ADD CONSTRAINT "LeadBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LeadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_callStatusKey_fkey" FOREIGN KEY ("callStatusKey") REFERENCES "CallStatus"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_dispositionKey_fkey" FOREIGN KEY ("dispositionKey") REFERENCES "LeadDisposition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCall" ADD CONSTRAINT "LeadCall_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TelesalesOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelesalesOrder" ADD CONSTRAINT "TelesalesOrder_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelesalesOrder" ADD CONSTRAINT "TelesalesOrder_orderTypeKey_fkey" FOREIGN KEY ("orderTypeKey") REFERENCES "TelesalesOrderType"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelesalesOrder" ADD CONSTRAINT "TelesalesOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
