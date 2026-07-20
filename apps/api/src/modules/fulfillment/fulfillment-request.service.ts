import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FulfillmentMode, SearchLocationSourceType } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { PLAN_WITH_DETAIL_INCLUDE } from './fulfillment-plan-include';

const CONFIRMED_MATCHING_STATUSES = ['CONFIRMED', 'MANUALLY_SELECTED'] as const;

export interface CreateSearchLocationInput {
  cityId?: string;
  districtId?: string;
  latitude?: number;
  longitude?: number;
  addressText?: string;
  postalCode?: string;
  sourceType: SearchLocationSourceType;
  geocodingStatus?: string;
  geocodingConfidence?: number;
  userConfirmed?: boolean;
  createdById?: string;
}

export interface CreateFulfillmentRequestInput {
  prescriptionId: string;
  medicationLineIds: string[];
  searchLocationId?: string;
  requestedFulfillmentMode?: FulfillmentMode;
  initiatedById?: string;
}

/**
 * Phase 6 §4/§16/§17 — builds a FulfillmentRequest from pharmacist-
 * confirmed medication lines only. Never reads
 * PrescriptionDrugCandidate directly and never accepts a line whose
 * matchingStatus isn't CONFIRMED/MANUALLY_SELECTED with a non-null
 * selectedDrugId (Phase 5's own safety rule, re-enforced here since a
 * later phase must not be able to route an unconfirmed OCR guess into
 * inventory search).
 */
@Injectable()
export class FulfillmentRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
  ) {}

  async createSearchLocation(input: CreateSearchLocationInput) {
    return this.prisma.searchLocation.create({
      data: {
        cityId: input.cityId ?? null,
        districtId: input.districtId ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        addressText: input.addressText ?? null,
        normalizedAddressText: input.addressText ? input.addressText.trim().toLowerCase() : null,
        postalCode: input.postalCode ?? null,
        sourceType: input.sourceType,
        geocodingStatus: input.geocodingStatus ?? null,
        geocodingConfidence: input.geocodingConfidence ?? null,
        userConfirmed: input.userConfirmed ?? false,
        createdById: input.createdById ?? null,
      },
    });
  }

  async createRequest(input: CreateFulfillmentRequestInput) {
    const lines = await this.prisma.prescriptionMedicationLine.findMany({
      where: { id: { in: input.medicationLineIds }, prescriptionId: input.prescriptionId },
      include: { selectedDrug: true },
    });
    if (lines.length !== input.medicationLineIds.length) {
      throw new NotFoundException('One or more medication lines were not found on this prescription');
    }
    for (const line of lines) {
      if (!CONFIRMED_MATCHING_STATUSES.includes(line.matchingStatus as (typeof CONFIRMED_MATCHING_STATUSES)[number])) {
        throw new BadRequestException(
          `Medication line ${line.id} is not pharmacist-confirmed (status: ${line.matchingStatus}) — only confirmed lines may enter fulfillment`,
        );
      }
      if (!line.selectedDrugId) {
        throw new BadRequestException(`Medication line ${line.id} has no selected drug`);
      }
    }

    if (input.searchLocationId) {
      const location = await this.prisma.searchLocation.findUnique({ where: { id: input.searchLocationId } });
      if (!location) throw new BadRequestException('Unknown searchLocationId');
    }

    const request = await this.prisma.fulfillmentRequest.create({
      data: {
        prescriptionId: input.prescriptionId,
        searchLocationId: input.searchLocationId ?? null,
        requestedFulfillmentMode: input.requestedFulfillmentMode ?? 'UNKNOWN',
        status: input.searchLocationId ? 'SEARCH_QUEUED' : 'LOCATION_REQUIRED',
        initiatedById: input.initiatedById ?? null,
        items: {
          create: lines.map((line) => ({
            medicationLineId: line.id,
            drugId: line.selectedDrugId!,
            coldChainRequired: line.selectedDrug?.coldChain ?? false,
            controlledDrug: line.selectedDrug?.controlledDrug ?? false,
            specialHandlingRequired: line.selectedDrug?.requiresSpecialHandling ?? false,
          })),
        },
      },
      include: { items: true },
    });

    await this.audit.record({
      actorId: input.initiatedById ?? null,
      action: 'fulfillment.request_create',
      entityType: 'fulfillment_request',
      entityId: request.id,
      after: { prescriptionId: input.prescriptionId, lineCount: lines.length },
    });
    await this.timeline.record({
      entityType: 'fulfillment_request',
      entityId: request.id,
      eventType: 'created',
      actorId: input.initiatedById ?? null,
    });

    return request;
  }

  async getRequest(id: string) {
    const request = await this.prisma.fulfillmentRequest.findUnique({
      where: { id },
      include: {
        items: { include: { drug: { select: { id: true, materialNo: true, nameEn: true, nameAr: true } } } },
        searchLocation: true,
        plans: {
          orderBy: { rank: 'asc' },
          include: PLAN_WITH_DETAIL_INCLUDE,
        },
      },
    });
    if (!request) throw new NotFoundException('Fulfillment request not found');
    return request;
  }

  async listPlans(fulfillmentRequestId: string) {
    const request = await this.prisma.fulfillmentRequest.findUnique({ where: { id: fulfillmentRequestId } });
    if (!request) throw new NotFoundException('Fulfillment request not found');
    return this.prisma.fulfillmentPlan.findMany({
      where: { fulfillmentRequestId },
      orderBy: { rank: 'asc' },
      include: { ...PLAN_WITH_DETAIL_INCLUDE, reservations: true },
    });
  }
}
