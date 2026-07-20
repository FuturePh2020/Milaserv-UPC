import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { resolveBranchOpenStatus } from '../branches/branch-hours-resolver';
import type { LegacyWorkingHours } from '../branches/branch-hours-resolver';
import { checkOperationalEligibility } from './branch-operational-eligibility-filter';
import { checkServiceability } from './branch-serviceability-filter';
import type { FulfillmentExclusionCode } from './fulfillment-exclusion-codes';

export interface EligibleBranchCandidate {
  branchId: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
}

export interface ExcludedBranchCandidate {
  branchId: string;
  exclusionCodes: FulfillmentExclusionCode[];
}

export interface CandidateGenerationResult {
  eligible: EligibleBranchCandidate[];
  excluded: ExcludedBranchCandidate[];
  citySearched: string;
}

/**
 * Phase 6 §18 Stages 1-3 — city filter, then serviceability, then
 * operational eligibility, in that order (§24: never search all
 * branches immediately). Every excluded branch is recorded with its
 * exclusion codes (§25) — nothing is silently dropped. Cross-city
 * expansion (§24 steps 2-6) is deliberately out of this step's scope;
 * this generator searches exactly the confirmed city.
 */
@Injectable()
export class BranchCandidateGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  async generate(fulfillmentRequestId: string): Promise<CandidateGenerationResult> {
    const request = await this.prisma.fulfillmentRequest.findUnique({
      where: { id: fulfillmentRequestId },
      include: { searchLocation: true, items: true },
    });
    if (!request) throw new NotFoundException('Fulfillment request not found');
    if (!request.searchLocation) {
      throw new BadRequestException('Fulfillment request has no search location set');
    }
    if (!request.searchLocation.cityId) {
      throw new BadRequestException(
        'Search location has no resolved cityId — cannot run Stage 1 city filtering on an unresolved location',
      );
    }

    const branches = await this.prisma.branch.findMany({
      where: { deletedAt: null, locationCityId: request.searchLocation.cityId },
      include: {
        serviceAreas: { where: { active: true } },
        capabilityAssignments: { where: { active: true }, include: { capability: true } },
        weeklyHours: { where: { active: true } },
        specialHours: { where: { active: true } },
      },
    });

    const location = {
      cityId: request.searchLocation.cityId,
      districtId: request.searchLocation.districtId,
      latitude: request.searchLocation.latitude,
      longitude: request.searchLocation.longitude,
    };
    const coldChainRequired = request.items.some((i) => i.coldChainRequired);
    const controlledDrugRequired = request.items.some((i) => i.controlledDrug);
    const specialHandlingRequired = request.items.some((i) => i.specialHandlingRequired);

    const now = new Date();
    const eligible: EligibleBranchCandidate[] = [];
    const excluded: ExcludedBranchCandidate[] = [];

    for (const branch of branches) {
      const serviceability = checkServiceability(branch.serviceAreas, location);
      if (!serviceability.eligible) {
        excluded.push({ branchId: branch.id, exclusionCodes: [serviceability.exclusionCode!] });
        continue;
      }

      const isOpenNow = resolveBranchOpenStatus(
        branch.workingHours as LegacyWorkingHours | null,
        branch.weeklyHours,
        branch.specialHours,
        now,
      );
      const branchCapabilityCodes = branch.capabilityAssignments.map((a) => a.capability.code);
      const operational = checkOperationalEligibility({
        active: branch.status === 'ACTIVE',
        temporarilyClosed: branch.temporarilyClosed,
        prescriptionFulfillmentEnabled: branch.prescriptionFulfillmentEnabled,
        isOpenNow,
        maximumDailyOrders: branch.maximumDailyOrders,
        // Concurrent-order-count tracking doesn't exist yet — capacity
        // exclusion is inert (never fires) until a later step wires in
        // real usage counts. Documented rather than fabricated.
        currentDailyOrderCount: 0,
        requiredCapabilityCodes: [],
        branchCapabilityCodes,
        coldChainRequired,
        controlledDrugRequired,
        specialHandlingRequired,
        requestedMode: request.requestedFulfillmentMode,
        serviceAreaDeliveryEnabled: serviceability.deliveryEnabled,
        serviceAreaPickupEnabled: serviceability.pickupEnabled,
      });
      if (!operational.eligible) {
        excluded.push({ branchId: branch.id, exclusionCodes: operational.exclusionCodes });
        continue;
      }

      eligible.push({
        branchId: branch.id,
        deliveryEnabled: serviceability.deliveryEnabled,
        pickupEnabled: serviceability.pickupEnabled,
      });
    }

    return { eligible, excluded, citySearched: request.searchLocation.cityId };
  }
}
