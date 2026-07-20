import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class BreaksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listTypes() {
    return this.prisma.breakType.findMany({ include: { taskLimits: true }, orderBy: { name: "asc" } });
  }

  createType(data: {
    name: string;
    code: string;
    maxDurationMinutes: number;
    isPaid?: boolean;
    maxPerShift?: number;
    requiresApproval?: boolean;
    canResume?: boolean;
    color?: string;
    maxConcurrentAgents?: number;
  }) {
    return this.prisma.breakType.create({ data });
  }

  updateType(id: string, data: Partial<{
    name: string;
    maxDurationMinutes: number;
    isPaid: boolean;
    maxPerShift: number;
    requiresApproval: boolean;
    canResume: boolean;
    isActive: boolean;
    color: string;
    maxConcurrentAgents: number;
  }>) {
    return this.prisma.breakType.update({ where: { id }, data });
  }

  setTaskLimit(breakTypeId: string, taskId: string, maxConcurrentAgents: number) {
    return this.prisma.breakTypeTaskLimit.upsert({
      where: { breakTypeId_taskId: { breakTypeId, taskId } },
      update: { maxConcurrentAgents },
      create: { breakTypeId, taskId, maxConcurrentAgents },
    });
  }

  private async currentTaskIdFor(userId: string): Promise<string | null> {
    const assignment = await this.prisma.taskAssignment.findFirst({
      where: { agentId: userId, endTime: null },
      orderBy: { startTime: "desc" },
    });
    return assignment?.taskId ?? null;
  }

  private async concurrentCountForTask(breakTypeId: string, taskId: string | null, excludeUserId?: string) {
    const activeBreaks = await this.prisma.breakRecord.findMany({
      where: { breakTypeId, status: "ACTIVE", userId: excludeUserId ? { not: excludeUserId } : undefined },
      select: { userId: true },
    });
    if (activeBreaks.length === 0) return 0;
    if (!taskId) return activeBreaks.length;

    const activeTaskAssignments = await this.prisma.taskAssignment.findMany({
      where: { agentId: { in: activeBreaks.map((b) => b.userId) }, taskId, endTime: null },
      select: { agentId: true },
    });
    return activeTaskAssignments.length;
  }

  private async remainingSecondsToday(userId: string, breakTypeId: string): Promise<number> {
    const breakType = await this.prisma.breakType.findUnique({ where: { id: breakTypeId } });
    if (!breakType) throw new NotFoundException("Break type not found");
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const usedToday = await this.prisma.breakRecord.aggregate({
      where: { userId, breakTypeId, startedAt: { gte: startOfDay } },
      _sum: { usedSeconds: true },
    });
    const usedSeconds = usedToday._sum.usedSeconds ?? 0;
    return Math.max(0, breakType.maxDurationMinutes * 60 - usedSeconds);
  }

  async start(params: {
    userId: string;
    breakTypeId: string;
    isAutomatic?: boolean;
    source?: "AGENT" | "ADMIN" | "SYSTEM";
    overrideReason?: string;
    overriddenByUserId?: string;
  }) {
    const session = await this.prisma.agentSession.findFirst({ where: { userId: params.userId, endedAt: null } });
    if (!session) throw new BadRequestException("An active work session is required to start a break");

    const activeBreak = await this.prisma.breakRecord.findFirst({ where: { userId: params.userId, status: "ACTIVE" } });
    if (activeBreak) throw new BadRequestException("You are already on a break");

    const breakType = await this.prisma.breakType.findUnique({ where: { id: params.breakTypeId }, include: { taskLimits: true } });
    if (!breakType || !breakType.isActive) throw new NotFoundException("Break type not found or inactive");

    const remaining = await this.remainingSecondsToday(params.userId, params.breakTypeId);
    if (remaining <= 0) {
      throw new ForbiddenException("You have used up your allowed duration for this break type today");
    }

    const taskId = await this.currentTaskIdFor(params.userId);
    const limit = taskId
      ? breakType.taskLimits.find((l) => l.taskId === taskId)?.maxConcurrentAgents ?? breakType.maxConcurrentAgents
      : breakType.maxConcurrentAgents;
    const concurrentCount = await this.concurrentCountForTask(params.breakTypeId, taskId);

    const limitReached = concurrentCount >= limit;
    if (limitReached && !params.overrideReason) {
      throw new ForbiddenException(
        `Maximum of ${limit} agents on "${breakType.name}" for this task already reached. An admin override with a reason is required.`,
      );
    }

    const record = await this.prisma.breakRecord.create({
      data: {
        userId: params.userId,
        sessionId: session.id,
        breakTypeId: params.breakTypeId,
        isAutomatic: params.isAutomatic ?? false,
        source: params.source ?? "AGENT",
        wasOverridden: limitReached,
        overrideReason: limitReached ? params.overrideReason : undefined,
        overriddenByUserId: limitReached ? params.overriddenByUserId : undefined,
      },
    });

    await this.prisma.user.update({ where: { id: params.userId }, data: { currentAgentStatus: "ON_BREAK" } });

    await this.audit.log({
      action: limitReached ? "BREAK_OVERRIDE" : "BREAK_START",
      userId: params.overriddenByUserId ?? params.userId,
      entityType: "BreakRecord",
      entityId: record.id,
      metadata: { breakTypeId: params.breakTypeId, targetUserId: params.userId, overrideReason: params.overrideReason },
    });

    return record;
  }

  async end(userId: string, endedByAdminId?: string) {
    const record = await this.prisma.breakRecord.findFirst({ where: { userId, status: "ACTIVE" } });
    if (!record) throw new BadRequestException("No active break to end");

    const breakType = await this.prisma.breakType.findUnique({ where: { id: record.breakTypeId } });
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - record.startedAt.getTime()) / 1000));
    const totalUsedSeconds = record.usedSeconds + elapsedSeconds;
    const fullyUsed = breakType ? totalUsedSeconds >= breakType.maxDurationMinutes * 60 : true;
    const canInterrupt = breakType?.canResume && !fullyUsed;

    const updated = await this.prisma.breakRecord.update({
      where: { id: record.id },
      data: {
        endedAt: new Date(),
        usedSeconds: totalUsedSeconds,
        status: canInterrupt ? "INTERRUPTED" : "ENDED",
      },
    });

    await this.prisma.user.update({ where: { id: userId }, data: { currentAgentStatus: "AVAILABLE" } });

    await this.audit.log({
      action: "BREAK_END",
      userId: endedByAdminId ?? userId,
      entityType: "BreakRecord",
      entityId: record.id,
      metadata: { targetUserId: userId, endedByAdmin: Boolean(endedByAdminId) },
    });

    return updated;
  }

  async resume(userId: string) {
    const interrupted = await this.prisma.breakRecord.findFirst({
      where: { userId, status: "INTERRUPTED" },
      orderBy: { startedAt: "desc" },
    });
    if (!interrupted) throw new BadRequestException("No interrupted break available to resume");

    return this.start({ userId, breakTypeId: interrupted.breakTypeId, source: "AGENT" });
  }

  async myToday(userId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const records = await this.prisma.breakRecord.findMany({
      where: { userId, startedAt: { gte: startOfDay } },
      include: { breakType: true },
      orderBy: { startedAt: "desc" },
    });
    const types = await this.prisma.breakType.findMany({ where: { isActive: true } });
    const remaining = await Promise.all(
      types.map(async (t) => ({ breakTypeId: t.id, name: t.name, remainingSeconds: await this.remainingSecondsToday(userId, t.id) })),
    );
    return { records, remaining };
  }

  async liveMonitor() {
    const activeBreaks = await this.prisma.breakRecord.findMany({
      where: { status: "ACTIVE" },
      include: {
        user: { include: { team: true, sessions: { where: { endedAt: null }, take: 1 } } },
        breakType: true,
      },
    });

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    return Promise.all(
      activeBreaks.map(async (b) => {
        const totalToday = await this.prisma.breakRecord.aggregate({
          where: { userId: b.userId, startedAt: { gte: startOfDay } },
          _sum: { usedSeconds: true },
        });
        const elapsedSeconds = Math.floor((Date.now() - b.startedAt.getTime()) / 1000);
        const session = b.user.sessions[0];
        return {
          agentId: b.userId,
          agentName: b.user.fullName,
          username: b.user.username,
          team: b.user.team?.name ?? null,
          breakType: b.breakType.name,
          breakTypeColor: b.breakType.color,
          startedAt: b.startedAt,
          currentDurationSeconds: elapsedSeconds,
          totalTodaySeconds: (totalToday._sum.usedSeconds ?? 0) + elapsedSeconds,
          sessionDurationSeconds: session ? Math.floor((Date.now() - session.startedAt.getTime()) / 1000) : null,
          isAutomatic: b.isAutomatic,
          wasOverridden: b.wasOverridden,
        };
      }),
    );
  }

  async adminCorrect(recordId: string, data: Record<string, unknown>, reason: string, actorId: string) {
    if (!reason) throw new BadRequestException("A reason is required to correct a break record");
    const record = await this.prisma.breakRecord.findUnique({ where: { id: recordId } });
    if (!record) throw new NotFoundException("Break record not found");
    const updated = await this.prisma.breakRecord.update({
      where: { id: recordId },
      data: { ...data, correctedReason: reason, correctedByUserId: actorId },
    });
    await this.audit.log({
      action: "BREAK_CORRECTION",
      userId: actorId,
      entityType: "BreakRecord",
      entityId: recordId,
      metadata: { reason, changes: data },
    });
    return updated;
  }
}
