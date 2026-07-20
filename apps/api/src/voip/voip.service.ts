import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { MockVoipProvider } from "./adapters/mock-voip.provider";
import { VoipSettingsService } from "./voip-settings.service";
import { decryptSecret } from "../common/utils/encryption";
import { CallDirection, CallStatus } from "@lcrm/shared";

@Injectable()
export class VoipService {
  private readonly logger = new Logger(VoipService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provider: MockVoipProvider,
    private readonly voipSettings: VoipSettingsService,
  ) {}

  async initiateOutboundCall(params: { agentId: string; leadId?: string; customerPhone: string; taskId?: string }) {
    const agent = await this.prisma.user.findUnique({ where: { id: params.agentId } });
    const result = await this.provider.initiateCall({
      agentId: params.agentId,
      agentExtension: agent?.extension ?? undefined,
      leadId: params.leadId,
      customerPhone: params.customerPhone,
      taskId: params.taskId,
    });

    const record = await this.prisma.callRecord.create({
      data: {
        externalCallId: result.externalCallId,
        direction: CallDirection.OUTBOUND,
        agentId: params.agentId,
        leadId: params.leadId,
        taskId: params.taskId,
        customerPhone: params.customerPhone,
        agentExtension: agent?.extension,
        startTime: new Date(),
        status: CallStatus.RINGING,
        voipProvider: "mock",
      },
    });

    await this.prisma.user.update({ where: { id: params.agentId }, data: { currentAgentStatus: "ON_CALL" } });

    return record;
  }

  async getCallStatus(agentId: string, externalCallId: string) {
    return this.provider.getCallStatus(externalCallId);
  }

  async myCalls(agentId: string, filters: { from?: Date; to?: Date }) {
    return this.prisma.callRecord.findMany({
      where: { agentId, createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined },
      orderBy: { createdAt: "desc" },
      include: { lead: { select: { id: true, customerName: true } } },
      take: 200,
    });
  }

  async listCallRecords(filters: {
    direction?: string;
    status?: string;
    agentId?: string;
    partnerId?: string;
    taskId?: string;
    from?: Date;
    to?: Date;
    page?: number;
    pageSize?: number;
  }) {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.pageSize ?? 50, 200);
    const where = {
      direction: filters.direction as any,
      status: filters.status as any,
      agentId: filters.agentId,
      partnerId: filters.partnerId,
      taskId: filters.taskId,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    };
    const [items, total] = await Promise.all([
      this.prisma.callRecord.findMany({
        where,
        include: { agent: { select: { id: true, fullName: true } }, lead: { select: { id: true, customerName: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.callRecord.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async metrics(filters: { agentId?: string; from?: Date; to?: Date }) {
    const where = {
      agentId: filters.agentId,
      createdAt: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined,
    };
    const calls = await this.prisma.callRecord.findMany({ where });

    const total = calls.length;
    const inbound = calls.filter((c) => c.direction === CallDirection.INBOUND).length;
    const outbound = calls.filter((c) => c.direction === CallDirection.OUTBOUND).length;
    const answered = calls.filter((c) => c.status === CallStatus.ANSWERED || c.status === CallStatus.COMPLETED).length;
    const busy = calls.filter((c) => c.status === CallStatus.BUSY).length;
    const noAnswer = calls.filter((c) => c.status === CallStatus.NO_ANSWER).length;
    const abandoned = calls.filter((c) => c.status === CallStatus.ABANDONED).length;
    const failed = calls.filter((c) => c.status === CallStatus.FAILED).length;

    const handled = calls.filter((c) => c.status === CallStatus.COMPLETED || c.status === CallStatus.ANSWERED);
    const sumTalk = handled.reduce((s, c) => s + c.talkTimeSeconds, 0);
    const sumHold = handled.reduce((s, c) => s + c.holdTimeSeconds, 0);
    const sumWrapUp = handled.reduce((s, c) => s + c.wrapUpTimeSeconds, 0);
    const aht = handled.length > 0 ? (sumTalk + sumHold + sumWrapUp) / handled.length : 0;

    const uniqueLeads = new Set(calls.filter((c) => c.leadId).map((c) => c.leadId)).size;

    return {
      totalCalls: total,
      inboundCalls: inbound,
      outboundCalls: outbound,
      answeredCalls: answered,
      busyCalls: busy,
      noAnswerCalls: noAnswer,
      abandonedCalls: abandoned,
      failedCalls: failed,
      answerRate: total > 0 ? answered / total : 0,
      abandonmentRate: total > 0 ? abandoned / total : 0,
      averageHandleTimeSeconds: aht,
      averageTalkTimeSeconds: handled.length > 0 ? sumTalk / handled.length : 0,
      uniqueLeadsContacted: uniqueLeads,
    };
  }

  async handleWebhook(rawPayload: any, signatureHeader: string | undefined) {
    const settings = await this.prisma.voipSettings.findUnique({ where: { id: "default" } });
    if (settings?.webhookSecretEncrypted) {
      const secret = decryptSecret(settings.webhookSecretEncrypted);
      const expected = createHmac("sha256", secret).update(JSON.stringify(rawPayload)).digest("hex");
      const provided = signatureHeader ?? "";
      const valid =
        provided.length === expected.length &&
        timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
      if (!valid) {
        throw new BadRequestException("Invalid webhook signature");
      }
    }

    const externalEventId: string = rawPayload.eventId || rawPayload.id || `${rawPayload.callId}-${rawPayload.status}-${Date.now()}`;

    try {
      await this.prisma.voipWebhookEvent.create({
        data: { externalEventId, rawPayload },
      });
    } catch (err: any) {
      if (err?.code === "P2002") {
        this.logger.log(`Duplicate webhook event ${externalEventId} ignored (idempotent)`);
        return { deduplicated: true };
      }
      throw err;
    }

    try {
      await this.applyWebhookPayload(rawPayload);
      await this.prisma.voipWebhookEvent.update({ where: { externalEventId }, data: { processedAt: new Date() } });
    } catch (error: any) {
      await this.prisma.voipWebhookEvent.update({
        where: { externalEventId },
        data: { processingError: String(error.message).slice(0, 1000) },
      });
      throw error;
    }

    return { processed: true };
  }

  private async applyWebhookPayload(payload: any) {
    const externalCallId: string = payload.callId;
    if (!externalCallId) {
      throw new BadRequestException("Webhook payload missing callId");
    }

    const mapping = await this.prisma.voipStatusMapping.findUnique({ where: { providerStatus: payload.status } });
    const internalStatus = mapping?.internalStatus ?? this.fallbackStatusMap(payload.status);

    const existing = await this.prisma.callRecord.findUnique({ where: { externalCallId } });

    const settings = await this.prisma.voipSettings.findUnique({ where: { id: "default" } });
    const agentMapping = (settings?.agentMapping as Record<string, string>) ?? {};
    const mappedAgentId = payload.agentExtension ? agentMapping[payload.agentExtension] : undefined;

    const data = {
      status: internalStatus as any,
      // A call's first webhook event (e.g. "ringing") often arrives before
      // the PBX has attached an agent extension; only mappedAgentId is set
      // then. A later event supplies it — without this on the shared
      // update-path `data`, that record could never get its agentId
      // backfilled since the update branch below only ever used `data`.
      agentId: mappedAgentId ?? existing?.agentId ?? undefined,
      talkTimeSeconds: payload.talkTimeSeconds ?? existing?.talkTimeSeconds ?? 0,
      holdTimeSeconds: payload.holdTimeSeconds ?? existing?.holdTimeSeconds ?? 0,
      wrapUpTimeSeconds: payload.wrapUpTimeSeconds ?? existing?.wrapUpTimeSeconds ?? 0,
      totalDurationSeconds: payload.totalDurationSeconds ?? existing?.totalDurationSeconds ?? 0,
      recordingUrl: payload.recordingUrl ?? existing?.recordingUrl,
      answerTime: payload.answerTime ? new Date(payload.answerTime) : existing?.answerTime,
      endTime: payload.endTime ? new Date(payload.endTime) : existing?.endTime,
      rawMetadata: payload as any,
    };

    if (existing) {
      await this.prisma.callRecord.update({ where: { externalCallId }, data });
    } else {
      await this.prisma.callRecord.create({
        data: {
          externalCallId,
          direction: (payload.direction as any) ?? CallDirection.INBOUND,
          customerPhone: payload.customerPhone ?? "unknown",
          agentExtension: payload.agentExtension,
          startTime: payload.startTime ? new Date(payload.startTime) : new Date(),
          voipProvider: settings?.providerName ?? "unknown",
          ...data,
        },
      });
    }
  }

  private fallbackStatusMap(rawStatus: string): string {
    const upper = (rawStatus || "").toUpperCase();
    if (Object.values(CallStatus).includes(upper as any)) return upper;
    return CallStatus.FAILED;
  }
}
