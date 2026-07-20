import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  AnsweredOutcomeType,
  BusinessOutcome,
  CallResultType,
  EventSource,
  LeadWorkflowStatus,
} from "@lcrm/shared";
import { PrismaService } from "../prisma/prisma.service";
import { TimelineService } from "../timeline/timeline.service";
import { AuditService } from "../audit/audit.service";
import { SettingsService } from "../settings/settings.service";
import { LeadsService } from "../leads/leads.service";
import { OrdersService } from "../orders/orders.service";
import { RetentionService } from "../retention/retention.service";

export interface RecordCallOutcomeInput {
  leadId: string;
  callRecordId?: string;
  callResult: string;
  answeredOutcome?: string;
  notes?: string;
  nextCallAt?: string;
  notInterestedReason?: string;
  preferredCallbackDate?: string;
  preferredCallbackTime?: string;
  followUpDate?: string;
  contactTimingType?: string;
  exactTime?: string;
  followUpPriority?: string;
  lastDispensingDate?: string;
  expectedNextRefillDate?: string;
  wrongLeadReason?: string;
  externalOrderNumber?: string;
}

const OUTCOMES_REQUIRING_MANDATORY_NOTES_BY_DEFAULT = [AnsweredOutcomeType.NOT_INTERESTED, AnsweredOutcomeType.WRONG_LEAD];

function mapWorkflowAndOutcome(input: RecordCallOutcomeInput): { workflowStatus: LeadWorkflowStatus; businessOutcome: BusinessOutcome } {
  if (input.callResult === CallResultType.NO_ANSWER) {
    return {
      workflowStatus: input.nextCallAt ? LeadWorkflowStatus.CALLBACK_REQUIRED : LeadWorkflowStatus.UNREACHABLE,
      businessOutcome: BusinessOutcome.NONE,
    };
  }
  switch (input.answeredOutcome) {
    case AnsweredOutcomeType.ORDER_CREATED:
      return { workflowStatus: LeadWorkflowStatus.CONVERTED, businessOutcome: BusinessOutcome.CONVERTED };
    case AnsweredOutcomeType.NOT_INTERESTED:
      return { workflowStatus: LeadWorkflowStatus.NOT_INTERESTED, businessOutcome: BusinessOutcome.NOT_INTERESTED };
    case AnsweredOutcomeType.WRONG_TIME:
    case AnsweredOutcomeType.RESCHEDULE_CALL:
      return { workflowStatus: LeadWorkflowStatus.CALLBACK_REQUIRED, businessOutcome: BusinessOutcome.CALLBACK };
    case AnsweredOutcomeType.ALREADY_DISPENSED:
      return { workflowStatus: LeadWorkflowStatus.COMPLETED, businessOutcome: BusinessOutcome.CONVERTED };
    case AnsweredOutcomeType.INTERESTED_FOLLOWUP:
      return { workflowStatus: LeadWorkflowStatus.INTERESTED, businessOutcome: BusinessOutcome.INTERESTED };
    case AnsweredOutcomeType.WRONG_LEAD:
      return { workflowStatus: LeadWorkflowStatus.INVALID_NUMBER, businessOutcome: BusinessOutcome.LOST };
    default:
      return { workflowStatus: LeadWorkflowStatus.CONTACTED, businessOutcome: BusinessOutcome.NONE };
  }
}

@Injectable()
export class CallOutcomesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline: TimelineService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly leadsService: LeadsService,
    private readonly ordersService: OrdersService,
    private readonly retention: RetentionService,
  ) {}

  async record(input: RecordCallOutcomeInput, agentId: string, meta: { ipAddress: string; userAgent: string }) {
    const lead = await this.prisma.lead.findUnique({ where: { id: input.leadId }, include: { partner: true } });
    if (!lead) throw new NotFoundException("Lead not found");

    const workflowSettings = await this.settings.getCrmWorkflowSettings();
    const mandatoryOutcomes = new Set([
      ...OUTCOMES_REQUIRING_MANDATORY_NOTES_BY_DEFAULT,
      ...((workflowSettings.mandatoryNotesOutcomes as string[]) ?? []),
    ]);
    if (input.answeredOutcome && mandatoryOutcomes.has(input.answeredOutcome as AnsweredOutcomeType) && !input.notes?.trim()) {
      throw new BadRequestException(`Notes are required for the "${input.answeredOutcome}" outcome`);
    }

    let orderId: string | undefined;
    if (input.answeredOutcome === AnsweredOutcomeType.ORDER_CREATED) {
      if (!input.externalOrderNumber) {
        throw new BadRequestException("External Order Number is required when creating an Order");
      }
      const order = await this.ordersService.createFromLead(
        {
          leadId: lead.id,
          agentId,
          callRecordId: input.callRecordId,
          externalOrderNumber: input.externalOrderNumber,
          notes: input.notes,
        },
        meta,
      );
      orderId = order.id;
    }

    const outcome = await this.prisma.leadCallOutcome.create({
      data: {
        leadId: lead.id,
        callRecordId: input.callRecordId,
        agentId,
        callResult: input.callResult as any,
        answeredOutcome: input.answeredOutcome as any,
        notes: input.notes,
        nextCallAt: input.nextCallAt ? new Date(input.nextCallAt) : undefined,
        notInterestedReason: input.notInterestedReason,
        preferredCallbackDate: input.preferredCallbackDate ? new Date(input.preferredCallbackDate) : undefined,
        preferredCallbackTime: input.preferredCallbackTime,
        followUpDate: input.followUpDate ? new Date(input.followUpDate) : undefined,
        contactTimingType: input.contactTimingType as any,
        exactTime: input.exactTime,
        followUpPriority: input.followUpPriority as any,
        lastDispensingDate: input.lastDispensingDate ? new Date(input.lastDispensingDate) : undefined,
        expectedNextRefillDate: input.expectedNextRefillDate ? new Date(input.expectedNextRefillDate) : undefined,
        wrongLeadReason: input.wrongLeadReason,
        orderId,
      },
    });

    await this.maybeCreateFollowUp(lead.id, agentId, input);

    if (input.answeredOutcome === AnsweredOutcomeType.ALREADY_DISPENSED) {
      await this.retention.upsertFromAlreadyDispensed({
        leadId: lead.id,
        customerName: lead.customerName,
        customerPhone: lead.primaryPhone,
        partnerId: lead.partnerId,
        agentId,
        lastDispensingDate: input.lastDispensingDate ? new Date(input.lastDispensingDate) : new Date(),
        expectedNextRefillDate: input.expectedNextRefillDate ? new Date(input.expectedNextRefillDate) : undefined,
      });
    }

    const { workflowStatus, businessOutcome } = mapWorkflowAndOutcome(input);
    const updatedLead = await this.leadsService.updateOutcome(lead.id, agentId, {
      workflowStatus,
      businessOutcome,
      notes: input.notes,
      callbackAt: input.nextCallAt ?? input.preferredCallbackDate ?? input.followUpDate,
    });

    await this.timeline.record({
      entityType: "Lead",
      entityId: lead.id,
      eventType: "LEAD_OUTCOME_SELECTED",
      actorUserId: agentId,
      newValue: { callResult: input.callResult, answeredOutcome: input.answeredOutcome },
      source: EventSource.AGENT,
      ipAddress: meta.ipAddress,
      notes: input.notes,
    });
    await this.audit.log({
      action: "CALL_OUTCOME_RECORDED",
      userId: agentId,
      entityType: "Lead",
      entityId: lead.id,
      metadata: { callResult: input.callResult, answeredOutcome: input.answeredOutcome, orderId },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { outcome, lead: updatedLead, orderId };
  }

  private async maybeCreateFollowUp(leadId: string, agentId: string, input: RecordCallOutcomeInput) {
    let followUpDate: Date | undefined;
    let timingType: string | undefined;
    let exactTime: string | undefined;
    let priority: string | undefined;
    let reason: string | undefined;

    if (input.callResult === CallResultType.NO_ANSWER && input.nextCallAt) {
      followUpDate = new Date(input.nextCallAt);
      reason = "No Answer - next call scheduled";
    } else if (input.answeredOutcome === AnsweredOutcomeType.WRONG_TIME && input.preferredCallbackDate) {
      followUpDate = new Date(input.preferredCallbackDate);
      exactTime = input.preferredCallbackTime;
      reason = "Wrong Time - preferred callback";
    } else if (input.answeredOutcome === AnsweredOutcomeType.RESCHEDULE_CALL && input.followUpDate) {
      followUpDate = new Date(input.followUpDate);
      timingType = input.contactTimingType;
      exactTime = input.exactTime;
      reason = "Reschedule Call";
    } else if (input.answeredOutcome === AnsweredOutcomeType.INTERESTED_FOLLOWUP && input.followUpDate) {
      followUpDate = new Date(input.followUpDate);
      timingType = input.contactTimingType;
      exactTime = input.exactTime;
      priority = input.followUpPriority;
      reason = "Interested for Follow-up";
    }

    if (!followUpDate) return null;

    const followUp = await this.prisma.followUp.create({
      data: {
        leadId,
        agentId,
        followUpDate,
        timingType: timingType as any,
        exactTime,
        priority: priority as any,
        reason,
        notes: input.notes,
        source: EventSource.AGENT,
      },
    });

    await this.timeline.record({
      entityType: "Lead",
      entityId: leadId,
      eventType: "FOLLOW_UP_SCHEDULED",
      actorUserId: agentId,
      newValue: { followUpDate, reason },
      source: EventSource.AGENT,
    });

    return followUp;
  }
}
