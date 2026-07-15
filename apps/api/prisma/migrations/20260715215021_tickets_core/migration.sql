-- CreateEnum
CREATE TYPE "SlaState" AS ENUM ('ON_TRACK', 'WARNING', 'BREACHED', 'PAUSED', 'MET');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "internalNumber" TEXT NOT NULL,
    "customerComplaintNumber" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "urgencyId" TEXT NOT NULL,
    "statusId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "relatedOrderNo" TEXT,
    "customerVisitAt" TIMESTAMP(3),
    "sapMaterialNo" TEXT,
    "itemNameAr" TEXT,
    "itemNameEn" TEXT,
    "branchId" TEXT,
    "branchSupervisorSnapshot" JSONB,
    "createdById" TEXT NOT NULL,
    "responsibleId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenCount" INTEGER NOT NULL DEFAULT 0,
    "lastCustomerResponseAt" TIMESTAMP(3),
    "slaPolicyId" TEXT,
    "firstResponseDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "slaState" "SlaState" NOT NULL DEFAULT 'ON_TRACK',
    "slaPausedAt" TIMESTAMP(3),
    "slaPausedTotalMinutes" INTEGER NOT NULL DEFAULT 0,
    "firstRespondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketTeam" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,

    CONSTRAINT "TicketTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketOwnership" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "reason" TEXT,
    "fromAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "toAt" TIMESTAMP(3),

    CONSTRAINT "TicketOwnership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketUpdate" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "updateTypeId" TEXT NOT NULL,
    "directedToTeamId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketResolution" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "rootCause" TEXT NOT NULL,
    "actionTaken" TEXT NOT NULL,
    "finalSolution" TEXT NOT NULL,
    "resolutionCategoryId" TEXT NOT NULL,
    "customerInformed" BOOLEAN NOT NULL,
    "resolvedById" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketResolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_internalNumber_key" ON "Ticket"("internalNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_customerComplaintNumber_key" ON "Ticket"("customerComplaintNumber");

-- CreateIndex
CREATE INDEX "Ticket_statusId_urgencyId_idx" ON "Ticket"("statusId", "urgencyId");

-- CreateIndex
CREATE INDEX "Ticket_responsibleId_idx" ON "Ticket"("responsibleId");

-- CreateIndex
CREATE INDEX "Ticket_createdById_idx" ON "Ticket"("createdById");

-- CreateIndex
CREATE INDEX "Ticket_branchId_idx" ON "Ticket"("branchId");

-- CreateIndex
CREATE INDEX "Ticket_createdAt_idx" ON "Ticket"("createdAt");

-- CreateIndex
CREATE INDEX "TicketTeam_teamId_idx" ON "TicketTeam"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TicketTeam_ticketId_teamId_key" ON "TicketTeam"("ticketId", "teamId");

-- CreateIndex
CREATE INDEX "TicketOwnership_ticketId_fromAt_idx" ON "TicketOwnership"("ticketId", "fromAt");

-- CreateIndex
CREATE INDEX "TicketUpdate_ticketId_createdAt_idx" ON "TicketUpdate"("ticketId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TicketResolution_ticketId_key" ON "TicketResolution"("ticketId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TicketCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_urgencyId_fkey" FOREIGN KEY ("urgencyId") REFERENCES "TicketUrgency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TicketStatus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTeam" ADD CONSTRAINT "TicketTeam_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketTeam" ADD CONSTRAINT "TicketTeam_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOwnership" ADD CONSTRAINT "TicketOwnership_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketOwnership" ADD CONSTRAINT "TicketOwnership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketUpdate" ADD CONSTRAINT "TicketUpdate_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketUpdate" ADD CONSTRAINT "TicketUpdate_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketUpdate" ADD CONSTRAINT "TicketUpdate_updateTypeId_fkey" FOREIGN KEY ("updateTypeId") REFERENCES "UpdateType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketResolution" ADD CONSTRAINT "TicketResolution_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketResolution" ADD CONSTRAINT "TicketResolution_resolutionCategoryId_fkey" FOREIGN KEY ("resolutionCategoryId") REFERENCES "ResolutionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
