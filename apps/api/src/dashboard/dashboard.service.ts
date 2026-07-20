import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async adminSummary() {
    const [
      totalLeads,
      assignedLeads,
      remainingLeads,
      completedLeads,
      insuranceLeads,
      cashLeads,
      agentStatusCounts,
      callStatusCounts,
    ] = await Promise.all([
      this.prisma.lead.count(),
      this.prisma.lead.count({ where: { assignmentStatus: { in: ["ASSIGNED", "RESERVED"] } } }),
      this.prisma.lead.count({ where: { assignmentStatus: "UNASSIGNED" } }),
      this.prisma.lead.count({ where: { workflowStatus: { in: ["COMPLETED", "CONVERTED"] } } }),
      this.prisma.lead.count({ where: { category: { code: "INSURANCE" } } }),
      this.prisma.lead.count({ where: { category: { code: "CASH" } } }),
      this.prisma.user.groupBy({ by: ["currentAgentStatus"], where: { role: "AGENT" }, _count: true }),
      this.prisma.callRecord.groupBy({ by: ["status"], _count: true }),
    ]);

    const agentCounts: Record<string, number> = {};
    agentStatusCounts.forEach((row) => {
      agentCounts[row.currentAgentStatus ?? "OFFLINE"] = row._count;
    });

    const callCounts: Record<string, number> = {};
    callStatusCounts.forEach((row) => {
      callCounts[row.status] = row._count;
    });

    const totalCalls = Object.values(callCounts).reduce((a, b) => a + b, 0);
    const answered = (callCounts["ANSWERED"] ?? 0) + (callCounts["COMPLETED"] ?? 0);

    const handled = await this.prisma.callRecord.aggregate({
      where: { status: { in: ["ANSWERED", "COMPLETED"] } },
      _avg: { talkTimeSeconds: true, holdTimeSeconds: true, wrapUpTimeSeconds: true },
      _count: true,
    });
    const avgAht =
      (handled._avg.talkTimeSeconds ?? 0) + (handled._avg.holdTimeSeconds ?? 0) + (handled._avg.wrapUpTimeSeconds ?? 0);

    const convertedCount = await this.prisma.lead.count({ where: { workflowStatus: "CONVERTED" } });

    return {
      totalLeads,
      assignedLeads,
      remainingLeads,
      completedLeads,
      insuranceLeads,
      cashLeads,
      activeAgents: Object.values(agentCounts).reduce((a, b) => a + b, 0) - (agentCounts["OFFLINE"] ?? 0),
      availableAgents: agentCounts["AVAILABLE"] ?? 0,
      agentsOnCalls: agentCounts["ON_CALL"] ?? 0,
      agentsOnBreak: agentCounts["ON_BREAK"] ?? 0,
      offlineAgents: agentCounts["OFFLINE"] ?? 0,
      totalInboundCalls: 0, // populated once inbound webhook volume exists; direction breakdown below
      totalOutboundCalls: totalCalls,
      answeredCalls: answered,
      busyCalls: callCounts["BUSY"] ?? 0,
      noAnswerCalls: callCounts["NO_ANSWER"] ?? 0,
      abandonedCalls: callCounts["ABANDONED"] ?? 0,
      averageAht: avgAht,
      conversionRate: totalLeads > 0 ? convertedCount / totalLeads : 0,
    };
  }

  async leadsByPartner() {
    const grouped = await this.prisma.lead.groupBy({ by: ["partnerId"], _count: true });
    const partners = await this.prisma.partner.findMany({ where: { id: { in: grouped.map((g) => g.partnerId) } } });
    return grouped.map((g) => ({
      partner: partners.find((p) => p.id === g.partnerId)?.name ?? "Unknown",
      count: g._count,
    }));
  }

  async leadsByCategory() {
    const grouped = await this.prisma.lead.groupBy({ by: ["categoryId"], _count: true });
    const categories = await this.prisma.leadCategory.findMany({ where: { id: { in: grouped.map((g) => g.categoryId) } } });
    return grouped.map((g) => ({
      category: categories.find((c) => c.id === g.categoryId)?.name ?? "Unknown",
      count: g._count,
    }));
  }

  async leadsByStatus() {
    const grouped = await this.prisma.lead.groupBy({ by: ["workflowStatus"], _count: true });
    return grouped.map((g) => ({ status: g.workflowStatus, count: g._count }));
  }

  async leadsByTask() {
    const grouped = await this.prisma.lead.groupBy({ by: ["taskId"], _count: true });
    const tasks = await this.prisma.task.findMany({ where: { id: { in: grouped.map((g) => g.taskId).filter(Boolean) as string[] } } });
    return grouped.map((g) => ({
      task: tasks.find((t) => t.id === g.taskId)?.name ?? "Unassigned",
      count: g._count,
    }));
  }

  async agentSummary(agentId: string) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [user, activeSession, activeAssignments, completedToday, totalAssigned, remainingEligible] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: agentId }, select: { fullName: true, currentAgentStatus: true } }),
      this.prisma.agentSession.findFirst({ where: { userId: agentId, endedAt: null } }),
      this.prisma.leadAssignment.count({ where: { agentId, releasedAt: null } }),
      this.prisma.leadAssignment.count({ where: { agentId, taskCompletionStatus: "COMPLETED", assignedAt: { gte: startOfDay } } }),
      this.prisma.leadAssignment.count({ where: { agentId } }),
      this.prisma.agentTaskPermission
        .findMany({ where: { userId: agentId }, select: { taskId: true } })
        .then((perms) =>
          this.prisma.lead.count({
            where: { taskId: { in: perms.map((p) => p.taskId) }, assignmentStatus: "UNASSIGNED", isDuplicate: false },
          }),
        ),
    ]);

    const calls = await this.prisma.callRecord.findMany({ where: { agentId, createdAt: { gte: startOfDay } } });
    const answered = calls.filter((c) => c.status === "ANSWERED" || c.status === "COMPLETED").length;
    const busy = calls.filter((c) => c.status === "BUSY").length;
    const noAnswer = calls.filter((c) => c.status === "NO_ANSWER").length;
    const abandoned = calls.filter((c) => c.status === "ABANDONED").length;
    const handled = calls.filter((c) => c.status === "ANSWERED" || c.status === "COMPLETED");
    const aht =
      handled.length > 0
        ? handled.reduce((s, c) => s + c.talkTimeSeconds + c.holdTimeSeconds + c.wrapUpTimeSeconds, 0) / handled.length
        : 0;

    return {
      fullName: user?.fullName,
      currentStatus: user?.currentAgentStatus,
      sessionActive: Boolean(activeSession),
      sessionStartedAt: activeSession?.startedAt ?? null,
      activeAssignments,
      completedToday,
      totalAssigned,
      remainingEligible,
      callsMadeToday: calls.length,
      answeredCalls: answered,
      busyCalls: busy,
      noAnswerCalls: noAnswer,
      abandonedCalls: abandoned,
      personalAht: aht,
    };
  }
}
