-- CreateEnum
CREATE TYPE "CallResultType" AS ENUM ('NO_ANSWER', 'ANSWERED');

-- CreateEnum
CREATE TYPE "AnsweredOutcomeType" AS ENUM ('ORDER_CREATED', 'NOT_INTERESTED', 'WRONG_TIME', 'RESCHEDULE_CALL', 'ALREADY_DISPENSED', 'INTERESTED_FOLLOWUP', 'WRONG_LEAD');

-- CreateEnum
CREATE TYPE "ContactTimingType" AS ENUM ('EXACT_TIME', 'MORNING', 'EVENING');

-- CreateEnum
CREATE TYPE "FollowUpStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('INSURANCE', 'CASH');

-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('INBOUND_CALL', 'LEADS', 'WHATSAPP', 'PARTNER', 'RETENTION_CUSTOMER');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'HOLDED', 'ON_THE_WAY', 'PICKED_UP', 'COMPLETED', 'CLOSED');

-- CreateEnum
CREATE TYPE "RefillMode" AS ENUM ('NUMBER_OF_DAYS', 'EXACT_DATE');

-- CreateEnum
CREATE TYPE "ProductImportBehavior" AS ENUM ('CREATE_ONLY', 'UPDATE_BY_CODE', 'UPDATE_BY_BARCODE', 'CREATE_AND_UPDATE', 'SKIP_DUPLICATES', 'REJECT_DUPLICATES');

-- CreateEnum
CREATE TYPE "EventSource" AS ENUM ('AGENT', 'ADMIN', 'SYSTEM', 'VOIP', 'IMPORT');

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNorm" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCallOutcome" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "callRecordId" TEXT,
    "agentId" TEXT NOT NULL,
    "callResult" "CallResultType" NOT NULL,
    "answeredOutcome" "AnsweredOutcomeType",
    "notes" TEXT,
    "nextCallAt" TIMESTAMP(3),
    "notInterestedReason" TEXT,
    "preferredCallbackDate" TIMESTAMP(3),
    "preferredCallbackTime" TEXT,
    "followUpDate" TIMESTAMP(3),
    "contactTimingType" "ContactTimingType",
    "exactTime" TEXT,
    "followUpPriority" "FollowUpPriority",
    "lastDispensingDate" TIMESTAMP(3),
    "expectedNextRefillDate" TIMESTAMP(3),
    "wrongLeadReason" TEXT,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadCallOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "customerId" TEXT,
    "agentId" TEXT NOT NULL,
    "followUpDate" TIMESTAMP(3) NOT NULL,
    "timingType" "ContactTimingType",
    "exactTime" TEXT,
    "priority" "FollowUpPriority",
    "reason" TEXT,
    "status" "FollowUpStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "source" "EventSource" NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "externalSystemId" TEXT NOT NULL DEFAULT 'DEFAULT',
    "externalOrderNumber" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "leadId" TEXT,
    "callRecordId" TEXT,
    "responsibleUserId" TEXT NOT NULL,
    "teamId" TEXT,
    "partnerId" TEXT,
    "orderType" "OrderType" NOT NULL,
    "source" "OrderSource" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "expectedValue" DOUBLE PRECISION,
    "completedValue" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "cancellationReason" TEXT,
    "cancellationNotes" TEXT,
    "nextRefillDate" TIMESTAMP(3),
    "refillIntervalDays" INTEGER,
    "refillMode" "RefillMode",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "itemCodeSnapshot" TEXT,
    "arabicNameSnapshot" TEXT,
    "englishNameSnapshot" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION,
    "lineValue" DOUBLE PRECISION,
    "discount" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusHistory" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "previousStatus" "OrderStatus",
    "newStatus" "OrderStatus" NOT NULL,
    "changedByUserId" TEXT,
    "source" "EventSource" NOT NULL DEFAULT 'AGENT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderNote" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'INTERNAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTarget" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "teamId" TEXT,
    "cashTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "insuranceTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "totalTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "effectiveMonth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionCustomer" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "partnerId" TEXT,
    "orderType" "OrderType",
    "lastOrderNumber" TEXT,
    "lastOrderDate" TIMESTAMP(3),
    "lastDispensingDate" TIMESTAMP(3),
    "lastItems" JSONB NOT NULL DEFAULT '[]',
    "nextRefillDate" TIMESTAMP(3),
    "responsibleAgentId" TEXT,
    "customerSource" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefillSchedule" (
    "id" TEXT NOT NULL,
    "retentionCustomerId" TEXT NOT NULL,
    "orderId" TEXT,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "intervalDays" INTEGER,
    "mode" "RefillMode" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefillSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arabicName" TEXT,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductSubcategory" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arabicName" TEXT,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductSubcategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DosageForm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arabicName" TEXT,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DosageForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arabicName" TEXT,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProductUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manufacturer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "arabicName" TEXT,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Manufacturer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Currency" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "barcode" TEXT,
    "arabicName" TEXT,
    "englishName" TEXT,
    "scientificName" TEXT,
    "activeIngredient" TEXT,
    "categoryId" TEXT,
    "subcategoryId" TEXT,
    "dosageFormId" TEXT,
    "strength" TEXT,
    "unitId" TEXT,
    "packSize" TEXT,
    "manufacturerId" TEXT,
    "defaultPrice" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "insuranceAvailable" BOOLEAN NOT NULL DEFAULT true,
    "cashAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "vatStatus" TEXT,
    "insuranceCode" TEXT,
    "sku" TEXT,
    "minQuantity" INTEGER,
    "maxQuantity" INTEGER,
    "refillEligible" BOOLEAN NOT NULL DEFAULT false,
    "requiresPrescription" BOOLEAN NOT NULL DEFAULT false,
    "controlledItem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPartner" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "partnerItemCode" TEXT,
    "partnerPrice" DOUBLE PRECISION,
    "insuranceCovered" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPartner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "behavior" "ProductImportBehavior" NOT NULL DEFAULT 'CREATE_AND_UPDATE',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdRows" INTEGER NOT NULL DEFAULT 0,
    "updatedRows" INTEGER NOT NULL DEFAULT 0,
    "skippedRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImportRowError" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImportRowError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "partnerId" TEXT,
    "previousPrice" DOUBLE PRECISION,
    "newPrice" DOUBLE PRECISION NOT NULL,
    "changedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorRole" TEXT,
    "previousValue" JSONB,
    "newValue" JSONB,
    "source" "EventSource" NOT NULL DEFAULT 'SYSTEM',
    "ipAddress" TEXT,
    "notes" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permission" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigurableReason" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ConfigurableReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmWorkflowSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "orderNumberFormat" TEXT NOT NULL DEFAULT 'DIGITS_ONLY',
    "mandatoryNotesOutcomes" JSONB NOT NULL DEFAULT '[]',
    "rescheduleMorningStart" TEXT NOT NULL DEFAULT '09:00',
    "rescheduleMorningEnd" TEXT NOT NULL DEFAULT '13:00',
    "rescheduleEveningStart" TEXT NOT NULL DEFAULT '16:00',
    "rescheduleEveningEnd" TEXT NOT NULL DEFAULT '21:00',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmWorkflowSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutoRefreshSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
    "minIntervalSeconds" INTEGER NOT NULL DEFAULT 10,
    "maxIntervalSeconds" INTEGER NOT NULL DEFAULT 300,
    "pauseWhileEditing" BOOLEAN NOT NULL DEFAULT true,
    "realtimeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fallbackPollingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pageIntervals" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutoRefreshSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_phoneNorm_idx" ON "Customer"("phoneNorm");

-- CreateIndex
CREATE INDEX "LeadCallOutcome_leadId_idx" ON "LeadCallOutcome"("leadId");

-- CreateIndex
CREATE INDEX "LeadCallOutcome_agentId_idx" ON "LeadCallOutcome"("agentId");

-- CreateIndex
CREATE INDEX "FollowUp_leadId_idx" ON "FollowUp"("leadId");

-- CreateIndex
CREATE INDEX "FollowUp_agentId_idx" ON "FollowUp"("agentId");

-- CreateIndex
CREATE INDEX "FollowUp_followUpDate_status_idx" ON "FollowUp"("followUpDate", "status");

-- CreateIndex
CREATE INDEX "Order_responsibleUserId_idx" ON "Order"("responsibleUserId");

-- CreateIndex
CREATE INDEX "Order_teamId_idx" ON "Order"("teamId");

-- CreateIndex
CREATE INDEX "Order_partnerId_idx" ON "Order"("partnerId");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_orderType_idx" ON "Order"("orderType");

-- CreateIndex
CREATE INDEX "Order_source_idx" ON "Order"("source");

-- CreateIndex
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_externalSystemId_externalOrderNumber_key" ON "Order"("externalSystemId", "externalOrderNumber");

-- CreateIndex
CREATE INDEX "OrderItem_orderId_idx" ON "OrderItem"("orderId");

-- CreateIndex
CREATE INDEX "OrderItem_productId_idx" ON "OrderItem"("productId");

-- CreateIndex
CREATE INDEX "OrderStatusHistory_orderId_idx" ON "OrderStatusHistory"("orderId");

-- CreateIndex
CREATE INDEX "OrderNote_orderId_idx" ON "OrderNote"("orderId");

-- CreateIndex
CREATE INDEX "OrderTarget_agentId_effectiveMonth_idx" ON "OrderTarget"("agentId", "effectiveMonth");

-- CreateIndex
CREATE INDEX "OrderTarget_teamId_effectiveMonth_idx" ON "OrderTarget"("teamId", "effectiveMonth");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionCustomer_customerId_key" ON "RetentionCustomer"("customerId");

-- CreateIndex
CREATE INDEX "RetentionCustomer_nextRefillDate_idx" ON "RetentionCustomer"("nextRefillDate");

-- CreateIndex
CREATE INDEX "RetentionCustomer_responsibleAgentId_idx" ON "RetentionCustomer"("responsibleAgentId");

-- CreateIndex
CREATE INDEX "RetentionCustomer_partnerId_idx" ON "RetentionCustomer"("partnerId");

-- CreateIndex
CREATE INDEX "RefillSchedule_retentionCustomerId_idx" ON "RefillSchedule"("retentionCustomerId");

-- CreateIndex
CREATE INDEX "RefillSchedule_scheduledDate_status_idx" ON "RefillSchedule"("scheduledDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_code_key" ON "ProductCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductSubcategory_code_key" ON "ProductSubcategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DosageForm_code_key" ON "DosageForm"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_code_key" ON "ProductUnit"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Manufacturer_code_key" ON "Manufacturer"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Currency_code_key" ON "Currency"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_itemCode_key" ON "Product"("itemCode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE INDEX "Product_arabicName_idx" ON "Product"("arabicName");

-- CreateIndex
CREATE INDEX "Product_englishName_idx" ON "Product"("englishName");

-- CreateIndex
CREATE INDEX "Product_scientificName_idx" ON "Product"("scientificName");

-- CreateIndex
CREATE INDEX "Product_activeIngredient_idx" ON "Product"("activeIngredient");

-- CreateIndex
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");

-- CreateIndex
CREATE INDEX "Product_isArchived_idx" ON "Product"("isArchived");

-- CreateIndex
CREATE INDEX "Product_categoryId_idx" ON "Product"("categoryId");

-- CreateIndex
CREATE INDEX "ProductPartner_partnerId_idx" ON "ProductPartner"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductPartner_productId_partnerId_key" ON "ProductPartner"("productId", "partnerId");

-- CreateIndex
CREATE INDEX "ProductImportRowError_batchId_idx" ON "ProductImportRowError"("batchId");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_idx" ON "ProductPriceHistory"("productId");

-- CreateIndex
CREATE INDEX "TimelineEvent_entityType_entityId_idx" ON "TimelineEvent"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "TimelineEvent_eventType_idx" ON "TimelineEvent"("eventType");

-- CreateIndex
CREATE INDEX "TimelineEvent_createdAt_idx" ON "TimelineEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserPermission_userId_permission_key" ON "UserPermission"("userId", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "ConfigurableReason_category_code_key" ON "ConfigurableReason"("category", "code");

-- AddForeignKey
ALTER TABLE "LeadCallOutcome" ADD CONSTRAINT "LeadCallOutcome_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCallOutcome" ADD CONSTRAINT "LeadCallOutcome_callRecordId_fkey" FOREIGN KEY ("callRecordId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCallOutcome" ADD CONSTRAINT "LeadCallOutcome_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadCallOutcome" ADD CONSTRAINT "LeadCallOutcome_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_callRecordId_fkey" FOREIGN KEY ("callRecordId") REFERENCES "CallRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderNote" ADD CONSTRAINT "OrderNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTarget" ADD CONSTRAINT "OrderTarget_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTarget" ADD CONSTRAINT "OrderTarget_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionCustomer" ADD CONSTRAINT "RetentionCustomer_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionCustomer" ADD CONSTRAINT "RetentionCustomer_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetentionCustomer" ADD CONSTRAINT "RetentionCustomer_responsibleAgentId_fkey" FOREIGN KEY ("responsibleAgentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefillSchedule" ADD CONSTRAINT "RefillSchedule_retentionCustomerId_fkey" FOREIGN KEY ("retentionCustomerId") REFERENCES "RetentionCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductSubcategory" ADD CONSTRAINT "ProductSubcategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_subcategoryId_fkey" FOREIGN KEY ("subcategoryId") REFERENCES "ProductSubcategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_dosageFormId_fkey" FOREIGN KEY ("dosageFormId") REFERENCES "DosageForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "ProductUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_manufacturerId_fkey" FOREIGN KEY ("manufacturerId") REFERENCES "Manufacturer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPartner" ADD CONSTRAINT "ProductPartner_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPartner" ADD CONSTRAINT "ProductPartner_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImportRowError" ADD CONSTRAINT "ProductImportRowError_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ProductImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermission" ADD CONSTRAINT "UserPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
