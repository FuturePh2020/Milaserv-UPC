import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { AuthUser } from '../auth/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';

const RESERVABLE_STATUSES = ['AVAILABLE', 'PARTIAL'] as const;

/**
 * Phase 6 §26 — the only place InventoryReservation rows are ever
 * created. A plan is never auto-selected by the engine (Step 5) and
 * stock is never reserved while a user is merely viewing options — this
 * runs only when an authorized user explicitly confirms one specific
 * plan for one specific request (brief §2/§26: "never silently
 * confirm"). Writes no real external system (no SAP contract exists
 * yet, same scope boundary as InventoryProvider) — this is the data
 * foundation only.
 */
@Injectable()
export class FulfillmentPlanSelectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  async selectPlan(actor: AuthUser, fulfillmentRequestId: string, planId: string, meta: { ip?: string }) {
    const plan = await this.prisma.fulfillmentPlan.findUnique({
      where: { id: planId },
      include: { branches: { include: { items: true } } },
    });
    if (!plan || plan.fulfillmentRequestId !== fulfillmentRequestId) {
      throw new NotFoundException('Fulfillment plan not found for this request');
    }
    if (plan.planType === 'NO_SAFE_PLAN') {
      throw new BadRequestException('This request has no viable plan to select');
    }
    if (plan.selected) {
      // Idempotent — re-confirming the same already-selected plan is a
      // no-op, not an error.
      return this.prisma.fulfillmentPlan.findUniqueOrThrow({
        where: { id: planId },
        include: { branches: { include: { items: true } } },
      });
    }
    const existingSelection = await this.prisma.fulfillmentPlan.findFirst({
      where: { fulfillmentRequestId, selected: true },
    });
    if (existingSelection) {
      throw new BadRequestException('Another plan has already been selected for this request');
    }

    const now = new Date();
    const reservationRows = plan.branches.flatMap((branch) =>
      branch.items
        .filter(
          (item) =>
            RESERVABLE_STATUSES.includes(item.availabilityStatus as (typeof RESERVABLE_STATUSES)[number]) &&
            item.allocatedQuantity != null &&
            item.allocatedQuantity > 0,
        )
        .map((item) => ({
          fulfillmentPlanId: plan.id,
          fulfillmentPlanItemId: item.id,
          branchId: branch.branchId,
          drugId: item.drugId,
          quantity: item.allocatedQuantity!,
          status: 'PENDING' as const,
          reservedById: actor.userId,
          reservedAt: now,
        })),
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.fulfillmentPlan.update({
        where: { id: planId },
        data: { selected: true, selectedById: actor.userId, selectedAt: now },
      });
      if (reservationRows.length > 0) {
        await tx.inventoryReservation.createMany({ data: reservationRows });
      }
      await tx.fulfillmentRequest.update({
        where: { id: fulfillmentRequestId },
        data: { status: 'PLAN_SELECTED' },
      });
    });

    await this.timeline.record({
      entityType: 'fulfillment_request',
      entityId: fulfillmentRequestId,
      eventType: 'plan_selected',
      actorId: actor.userId,
      payload: { planId, reservationCount: reservationRows.length },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'fulfillment.plan_select',
      entityType: 'fulfillment_plan',
      entityId: planId,
      after: { fulfillmentRequestId, reservationCount: reservationRows.length },
      ...meta,
    });

    return this.prisma.fulfillmentPlan.findUniqueOrThrow({
      where: { id: planId },
      include: { branches: { include: { items: true } }, reservations: true },
    });
  }
}
