-- CreateEnum
CREATE TYPE "WorkSessionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "SessionEndReason" AS ENUM ('MANUAL', 'AUTO');

-- CreateEnum
CREATE TYPE "WorkPeriodType" AS ENUM ('WORK', 'BREAK', 'IDLE');

-- CreateTable
CREATE TABLE "WorkSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "status" "WorkSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" "SessionEndReason",
    "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "idleSeconds" INTEGER NOT NULL DEFAULT 0,
    "breakSeconds" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WorkSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkPeriod" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "WorkPeriodType" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "WorkPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkSession_userId_status_idx" ON "WorkSession"("userId", "status");

-- CreateIndex
CREATE INDEX "WorkSession_status_lastHeartbeatAt_idx" ON "WorkSession"("status", "lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "WorkSession_teamId_status_idx" ON "WorkSession"("teamId", "status");

-- CreateIndex
CREATE INDEX "WorkPeriod_sessionId_endedAt_idx" ON "WorkPeriod"("sessionId", "endedAt");

-- CreateIndex
CREATE INDEX "WorkPeriod_type_endedAt_startedAt_idx" ON "WorkPeriod"("type", "endedAt", "startedAt");

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkSession" ADD CONSTRAINT "WorkSession_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkPeriod" ADD CONSTRAINT "WorkPeriod_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One ACTIVE session per user (spec §2 invariant) — partial unique index.
CREATE UNIQUE INDEX "WorkSession_one_active_per_user"
  ON "WorkSession"("userId") WHERE "status" = 'ACTIVE';
