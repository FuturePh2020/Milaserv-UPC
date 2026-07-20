-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('AVAILABLE', 'WORKING_ON_LEAD', 'ON_CALL', 'ON_BREAK', 'STANDBY', 'OFFLINE');

-- CreateEnum
CREATE TYPE "LeadWorkflowStatus" AS ENUM ('NEW', 'ASSIGNED', 'IN_PROGRESS', 'CONTACTED', 'CALLBACK_REQUIRED', 'INVALID_NUMBER', 'NOT_INTERESTED', 'INTERESTED', 'CONVERTED', 'COMPLETED', 'ESCALATED', 'UNREACHABLE', 'RETURNED_TO_POOL', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "BusinessOutcome" AS ENUM ('NONE', 'INTERESTED', 'NOT_INTERESTED', 'CONVERTED', 'CALLBACK', 'LOST');

-- CreateEnum
CREATE TYPE "TaskCompletionStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('UNASSIGNED', 'RESERVED', 'ASSIGNED', 'RETURNED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ANSWERED', 'CONNECTED', 'BUSY', 'NO_ANSWER', 'ABANDONED', 'FAILED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DistributionStrategy" AS ENUM ('FIFO', 'OLDEST_FIRST', 'HIGHEST_PRIORITY', 'ROUND_ROBIN', 'WEIGHTED', 'PARTNER_PRIORITY', 'TASK_PRIORITY', 'REGION_MATCH', 'CATEGORY_MATCH', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatusChangeSource" AS ENUM ('AGENT', 'ADMIN', 'SYSTEM', 'VOIP');

-- CreateEnum
CREATE TYPE "BreakRecordStatus" AS ENUM ('ACTIVE', 'ENDED', 'INTERRUPTED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'PREVIEWING', 'VALIDATING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DuplicateHandling" AS ENUM ('SKIP', 'IMPORT', 'MARK_FOR_REVIEW');

-- CreateEnum
CREATE TYPE "AssignmentSource" AS ENUM ('AUTO_DISTRIBUTION', 'MANUAL', 'REASSIGNMENT');

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "teamId" TEXT,
    "extension" TEXT,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "currentAgentStatus" "AgentStatus" DEFAULT 'OFFLINE',
    "lastActivityAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedBy" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "partnerType" TEXT,
    "insuranceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "cashEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "logoUrl" TEXT,
    "contactPerson" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "defaultTaskId" TEXT,
    "customFieldDefs" JSONB NOT NULL DEFAULT '[]',
    "requiredImportColumns" JSONB NOT NULL DEFAULT '[]',
    "duplicateRuleFields" JSONB NOT NULL DEFAULT '["phone"]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerLeadCategory" (
    "partnerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "PartnerLeadCategory_pkey" PRIMARY KEY ("partnerId","categoryId")
);

-- CreateTable
CREATE TABLE "PartnerColumnMapping" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PartnerColumnMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "requiredQuantity" INTEGER NOT NULL DEFAULT 0,
    "dailyTarget" INTEGER NOT NULL DEFAULT 0,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxActiveAgents" INTEGER NOT NULL DEFAULT 0,
    "maxConcurrentBreaks" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskLeadCategory" (
    "taskId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,

    CONSTRAINT "TaskLeadCategory_pkey" PRIMARY KEY ("taskId","categoryId")
);

-- CreateTable
CREATE TABLE "TaskPartnerRestriction" (
    "taskId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,

    CONSTRAINT "TaskPartnerRestriction_pkey" PRIMARY KEY ("taskId","partnerId")
);

-- CreateTable
CREATE TABLE "AgentTaskPermission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTaskPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentPartnerRestriction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentPartnerRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCategoryRestriction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCategoryRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadImportBatch" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "taskId" TEXT,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "duplicateHandling" "DuplicateHandling" NOT NULL DEFAULT 'MARK_FOR_REVIEW',
    "columnMapping" JSONB NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "uploadedById" TEXT NOT NULL,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "LeadImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectedImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawData" JSONB NOT NULL,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RejectedImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "externalReference" TEXT,
    "customerName" TEXT NOT NULL,
    "primaryPhone" TEXT NOT NULL,
    "primaryPhoneNorm" TEXT NOT NULL,
    "secondaryPhone" TEXT,
    "nationalOrInsId" TEXT,
    "city" TEXT,
    "area" TEXT,
    "address" TEXT,
    "source" TEXT,
    "notes" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "categoryId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "taskId" TEXT,
    "batchId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "workflowStatus" "LeadWorkflowStatus" NOT NULL DEFAULT 'NEW',
    "assignmentStatus" "AssignmentStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "isDuplicate" BOOLEAN NOT NULL DEFAULT false,
    "duplicateOfLeadId" TEXT,
    "reservedAt" TIMESTAMP(3),
    "reservedUntil" TIMESTAMP(3),
    "assignedAgentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAssignment" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskId" TEXT,
    "partnerId" TEXT NOT NULL,
    "source" "AssignmentSource" NOT NULL DEFAULT 'AUTO_DISTRIBUTION',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,
    "taskCompletionStatus" "TaskCompletionStatus" NOT NULL DEFAULT 'PENDING',
    "businessOutcome" "BusinessOutcome" NOT NULL DEFAULT 'NONE',
    "callbackAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3),

    CONSTRAINT "LeadAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStatusHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "previousStatus" "LeadWorkflowStatus",
    "newStatus" "LeadWorkflowStatus" NOT NULL,
    "changedByUserId" TEXT,
    "source" "StatusChangeSource" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "productiveSeconds" INTEGER NOT NULL DEFAULT 0,
    "breakSeconds" INTEGER NOT NULL DEFAULT 0,
    "standbySeconds" INTEGER NOT NULL DEFAULT 0,
    "idleSeconds" INTEGER NOT NULL DEFAULT 0,
    "offlineSeconds" INTEGER NOT NULL DEFAULT 0,
    "leadsHandled" INTEGER NOT NULL DEFAULT 0,
    "callsMade" INTEGER NOT NULL DEFAULT 0,
    "callsAnswered" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "correctedReason" TEXT,
    "correctedByUserId" TEXT,

    CONSTRAINT "AgentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "maxDurationMinutes" INTEGER NOT NULL,
    "isPaid" BOOLEAN NOT NULL DEFAULT true,
    "maxPerShift" INTEGER NOT NULL DEFAULT 0,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "canResume" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "maxConcurrentAgents" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreakType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakTypeTaskLimit" (
    "id" TEXT NOT NULL,
    "breakTypeId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "maxConcurrentAgents" INTEGER NOT NULL,

    CONSTRAINT "BreakTypeTaskLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "breakTypeId" TEXT NOT NULL,
    "status" "BreakRecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "usedSeconds" INTEGER NOT NULL DEFAULT 0,
    "isAutomatic" BOOLEAN NOT NULL DEFAULT false,
    "wasOverridden" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overriddenByUserId" TEXT,
    "correctedReason" TEXT,
    "correctedByUserId" TEXT,
    "source" "StatusChangeSource" NOT NULL DEFAULT 'AGENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BreakRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DistributionSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "strategy" "DistributionStrategy" NOT NULL DEFAULT 'FIFO',
    "maxActiveLeadsPerAgent" INTEGER NOT NULL DEFAULT 1,
    "allowNextBeforeCompletion" BOOLEAN NOT NULL DEFAULT false,
    "reservationTimeoutMinutes" INTEGER NOT NULL DEFAULT 30,
    "autoReturnUntouched" BOOLEAN NOT NULL DEFAULT true,
    "maxLeadsPerHour" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DistributionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InactivitySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inactivityThresholdMinutes" INTEGER NOT NULL DEFAULT 10,
    "warningBeforeMinutes" INTEGER NOT NULL DEFAULT 2,
    "gracePeriodMinutes" INTEGER NOT NULL DEFAULT 2,
    "actionType" TEXT NOT NULL DEFAULT 'STANDBY',
    "autoBreakTypeId" TEXT,
    "heartbeatIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
    "heartbeatTimeoutSeconds" INTEGER NOT NULL DEFAULT 90,
    "resumePreviousStatusOnActivity" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InactivitySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecuritySettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "maxFailedLoginAttempts" INTEGER NOT NULL DEFAULT 5,
    "lockoutDurationMinutes" INTEGER NOT NULL DEFAULT 15,
    "accessTokenTtlMinutes" INTEGER NOT NULL DEFAULT 15,
    "refreshTokenTtlDays" INTEGER NOT NULL DEFAULT 7,
    "passwordMinLength" INTEGER NOT NULL DEFAULT 8,
    "passwordRequireUppercase" BOOLEAN NOT NULL DEFAULT true,
    "passwordRequireNumber" BOOLEAN NOT NULL DEFAULT true,
    "passwordRequireSymbol" BOOLEAN NOT NULL DEFAULT false,
    "maxUploadSizeMb" INTEGER NOT NULL DEFAULT 20,
    "allowMultipleActiveSessions" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecuritySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BreakThresholdSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "warningMinutes" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BreakThresholdSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "allocationType" TEXT NOT NULL DEFAULT 'MANUAL',
    "target" INTEGER NOT NULL DEFAULT 0,
    "actualCompleted" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoipSettings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "providerName" TEXT NOT NULL DEFAULT 'mock',
    "apiBaseUrl" TEXT,
    "apiKeyEncrypted" TEXT,
    "apiSecretEncrypted" TEXT,
    "usernameEncrypted" TEXT,
    "passwordEncrypted" TEXT,
    "webhookSecretEncrypted" TEXT,
    "extensionMapping" JSONB NOT NULL DEFAULT '{}',
    "agentMapping" JSONB NOT NULL DEFAULT '{}',
    "pollingIntervalSeconds" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "ahtFormula" TEXT NOT NULL DEFAULT '(talkTime + holdTime + wrapUpTime) / handledCalls',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoipSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoipStatusMapping" (
    "id" TEXT NOT NULL,
    "providerStatus" TEXT NOT NULL,
    "internalStatus" "CallStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoipStatusMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoipWebhookEvent" (
    "id" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "rawPayload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoipWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRecord" (
    "id" TEXT NOT NULL,
    "externalCallId" TEXT,
    "direction" "CallDirection" NOT NULL,
    "agentId" TEXT,
    "leadId" TEXT,
    "partnerId" TEXT,
    "taskId" TEXT,
    "customerPhone" TEXT NOT NULL,
    "agentExtension" TEXT,
    "startTime" TIMESTAMP(3),
    "ringTime" INTEGER,
    "answerTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "talkTimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "holdTimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "wrapUpTimeSeconds" INTEGER NOT NULL DEFAULT 0,
    "totalDurationSeconds" INTEGER NOT NULL DEFAULT 0,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "disposition" TEXT,
    "recordingUrl" TEXT,
    "voipProvider" TEXT,
    "rawMetadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCategory_name_key" ON "LeadCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LeadCategory_code_key" ON "LeadCategory"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerColumnMapping_partnerId_name_key" ON "PartnerColumnMapping"("partnerId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Task_code_key" ON "Task"("code");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTaskPermission_userId_taskId_key" ON "AgentTaskPermission"("userId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentPartnerRestriction_userId_partnerId_key" ON "AgentPartnerRestriction"("userId", "partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCategoryRestriction_userId_categoryId_key" ON "AgentCategoryRestriction"("userId", "categoryId");

-- CreateIndex
CREATE INDEX "LeadImportBatch_partnerId_idx" ON "LeadImportBatch"("partnerId");

-- CreateIndex
CREATE INDEX "LeadImportBatch_status_idx" ON "LeadImportBatch"("status");

-- CreateIndex
CREATE INDEX "RejectedImportRow_batchId_idx" ON "RejectedImportRow"("batchId");

-- CreateIndex
CREATE INDEX "Lead_partnerId_categoryId_assignmentStatus_workflowStatus_idx" ON "Lead"("partnerId", "categoryId", "assignmentStatus", "workflowStatus");

-- CreateIndex
CREATE INDEX "Lead_primaryPhoneNorm_idx" ON "Lead"("primaryPhoneNorm");

-- CreateIndex
CREATE INDEX "Lead_batchId_idx" ON "Lead"("batchId");

-- CreateIndex
CREATE INDEX "Lead_taskId_idx" ON "Lead"("taskId");

-- CreateIndex
CREATE INDEX "LeadAssignment_leadId_idx" ON "LeadAssignment"("leadId");

-- CreateIndex
CREATE INDEX "LeadAssignment_agentId_idx" ON "LeadAssignment"("agentId");

-- CreateIndex
CREATE INDEX "LeadStatusHistory_leadId_idx" ON "LeadStatusHistory"("leadId");

-- CreateIndex
CREATE INDEX "AgentSession_userId_endedAt_idx" ON "AgentSession"("userId", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BreakType_code_key" ON "BreakType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BreakTypeTaskLimit_breakTypeId_taskId_key" ON "BreakTypeTaskLimit"("breakTypeId", "taskId");

-- CreateIndex
CREATE INDEX "BreakRecord_userId_status_idx" ON "BreakRecord"("userId", "status");

-- CreateIndex
CREATE INDEX "BreakRecord_breakTypeId_status_idx" ON "BreakRecord"("breakTypeId", "status");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskId_idx" ON "TaskAssignment"("taskId");

-- CreateIndex
CREATE INDEX "TaskAssignment_agentId_idx" ON "TaskAssignment"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "VoipStatusMapping_providerStatus_key" ON "VoipStatusMapping"("providerStatus");

-- CreateIndex
CREATE UNIQUE INDEX "VoipWebhookEvent_externalEventId_key" ON "VoipWebhookEvent"("externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_externalCallId_key" ON "CallRecord"("externalCallId");

-- CreateIndex
CREATE INDEX "CallRecord_agentId_idx" ON "CallRecord"("agentId");

-- CreateIndex
CREATE INDEX "CallRecord_leadId_idx" ON "CallRecord"("leadId");

-- CreateIndex
CREATE INDEX "CallRecord_status_idx" ON "CallRecord"("status");

-- CreateIndex
CREATE INDEX "CallRecord_direction_idx" ON "CallRecord"("direction");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_defaultTaskId_fkey" FOREIGN KEY ("defaultTaskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLeadCategory" ADD CONSTRAINT "PartnerLeadCategory_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerLeadCategory" ADD CONSTRAINT "PartnerLeadCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LeadCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerColumnMapping" ADD CONSTRAINT "PartnerColumnMapping_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLeadCategory" ADD CONSTRAINT "TaskLeadCategory_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskLeadCategory" ADD CONSTRAINT "TaskLeadCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LeadCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPartnerRestriction" ADD CONSTRAINT "TaskPartnerRestriction_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPartnerRestriction" ADD CONSTRAINT "TaskPartnerRestriction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskPermission" ADD CONSTRAINT "AgentTaskPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTaskPermission" ADD CONSTRAINT "AgentTaskPermission_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPartnerRestriction" ADD CONSTRAINT "AgentPartnerRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentPartnerRestriction" ADD CONSTRAINT "AgentPartnerRestriction_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCategoryRestriction" ADD CONSTRAINT "AgentCategoryRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCategoryRestriction" ADD CONSTRAINT "AgentCategoryRestriction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LeadCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadImportBatch" ADD CONSTRAINT "LeadImportBatch_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RejectedImportRow" ADD CONSTRAINT "RejectedImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LeadImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "LeadCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LeadImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAssignment" ADD CONSTRAINT "LeadAssignment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSession" ADD CONSTRAINT "AgentSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakTypeTaskLimit" ADD CONSTRAINT "BreakTypeTaskLimit_breakTypeId_fkey" FOREIGN KEY ("breakTypeId") REFERENCES "BreakType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakTypeTaskLimit" ADD CONSTRAINT "BreakTypeTaskLimit_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakRecord" ADD CONSTRAINT "BreakRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakRecord" ADD CONSTRAINT "BreakRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AgentSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BreakRecord" ADD CONSTRAINT "BreakRecord_breakTypeId_fkey" FOREIGN KEY ("breakTypeId") REFERENCES "BreakType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
