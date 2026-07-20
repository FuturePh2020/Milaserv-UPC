import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";

@Injectable()
export class SessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  async start(userId: string) {
    const security = await this.settings.getSecuritySettings();
    const existing = await this.prisma.agentSession.findFirst({ where: { userId, endedAt: null } });
    if (existing && !security.allowMultipleActiveSessions) {
      throw new BadRequestException("You already have an active session");
    }

    const session = await this.prisma.agentSession.create({ data: { userId } });
    await this.prisma.user.update({ where: { id: userId }, data: { currentAgentStatus: "AVAILABLE", lastActivityAt: new Date(), lastHeartbeatAt: new Date() } });
    await this.audit.log({ action: "SESSION_START", userId, entityType: "AgentSession", entityId: session.id });
    return session;
  }

  async end(userId: string) {
    const session = await this.prisma.agentSession.findFirst({ where: { userId, endedAt: null } });
    if (!session) {
      throw new BadRequestException("No active session to end");
    }
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt.getTime()) / 1000));
    const updated = await this.prisma.agentSession.update({
      where: { id: session.id },
      data: {
        endedAt: new Date(),
        productiveSeconds: Math.max(0, elapsedSeconds - session.breakSeconds - session.standbySeconds - session.idleSeconds),
      },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { currentAgentStatus: "OFFLINE" } });
    await this.audit.log({ action: "SESSION_END", userId, entityType: "AgentSession", entityId: session.id });
    return updated;
  }

  async getActive(userId: string) {
    return this.prisma.agentSession.findFirst({ where: { userId, endedAt: null } });
  }

  async heartbeat(userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { lastHeartbeatAt: new Date(), lastActivityAt: new Date() } });
    return { ok: true, serverTime: new Date().toISOString() };
  }

  /**
   * Manual status changes an agent may make directly. System-driven states
   * (WORKING_ON_LEAD, ON_CALL, ON_BREAK, STANDBY) are set by their owning
   * subsystems, not this endpoint, to keep the state machine authoritative.
   */
  async setManualStatus(userId: string, status: "AVAILABLE" | "OFFLINE") {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    if (status === "AVAILABLE") {
      const activeSession = await this.prisma.agentSession.findFirst({ where: { userId, endedAt: null } });
      if (!activeSession) {
        throw new ForbiddenException("Start a work session before going Available");
      }
    }
    return this.prisma.user.update({ where: { id: userId }, data: { currentAgentStatus: status } });
  }

  async listActive() {
    return this.prisma.agentSession.findMany({
      where: { endedAt: null },
      include: { user: { select: { id: true, username: true, fullName: true, currentAgentStatus: true, team: true } } },
      orderBy: { startedAt: "desc" },
    });
  }

  async adminEnd(sessionId: string, actorId: string) {
    const session = await this.prisma.agentSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException("Session not found");
    if (session.endedAt) throw new BadRequestException("Session already ended");
    const updated = await this.prisma.agentSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });
    await this.prisma.user.update({ where: { id: session.userId }, data: { currentAgentStatus: "OFFLINE" } });
    await this.audit.log({
      action: "SESSION_END",
      userId: actorId,
      entityType: "AgentSession",
      entityId: sessionId,
      metadata: { endedByAdmin: true, targetUserId: session.userId },
    });
    return updated;
  }

  async adminCorrect(sessionId: string, data: Record<string, unknown>, reason: string, actorId: string) {
    if (!reason) throw new BadRequestException("A reason is required to correct a session record");
    const session = await this.prisma.agentSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException("Session not found");
    const updated = await this.prisma.agentSession.update({
      where: { id: sessionId },
      data: { ...data, correctedReason: reason, correctedByUserId: actorId },
    });
    await this.audit.log({
      action: "SESSION_CORRECTION",
      userId: actorId,
      entityType: "AgentSession",
      entityId: sessionId,
      metadata: { reason, changes: data },
    });
    return updated;
  }

  async history(userId: string) {
    return this.prisma.agentSession.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: 100 });
  }
}
