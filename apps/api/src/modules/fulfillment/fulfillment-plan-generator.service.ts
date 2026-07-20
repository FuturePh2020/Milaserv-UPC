import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { classifyFreshness, computeAvailableQuantity } from '../inventory/inventory-calculations';
import { INVENTORY_PROVIDER } from '../inventory/inventory-provider.interface';
import type { InventoryProvider } from '../inventory/inventory-provider.interface';
import { SettingsService } from '../settings/settings.service';
import { BranchCandidateGeneratorService } from './branch-candidate-generator.service';
import { computeBranchCoverage } from './branch-inventory-coverage';
import { FulfillmentConfigService } from './fulfillment-config.service';
import { PLAN_WITH_DETAIL_INCLUDE } from './fulfillment-plan-include';
import { scoreBranch, scorePlan } from './branch-ranking-scorer';
import { selectSplitPlan } from './split-plan-selector';
import type { SplitCandidateBranch } from './split-plan-selector';

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Phase 6 §18-§22 Stage 4-5 — checks inventory for every Stage-1-3
 * eligible branch, scores each, then generates and persists ranked
 * FulfillmentPlan rows: single-branch-complete plans first (§19 —
 * they outrank splits by design, via scorePlan's bonus/penalty), a
 * bounded greedy split plan if no single branch covers everything
 * (§20), or one explicit NO_SAFE_PLAN row explaining why nothing
 * qualifies — the engine never returns silence, and it never
 * auto-selects: `selected` stays false until an authorized user acts.
 */
@Injectable()
export class FulfillmentPlanGeneratorService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INVENTORY_PROVIDER) private readonly inventoryProvider: InventoryProvider,
    private readonly candidateGenerator: BranchCandidateGeneratorService,
    private readonly config: FulfillmentConfigService,
    private readonly settings: SettingsService,
  ) {}

  async generate(fulfillmentRequestId: string) {
    const request = await this.prisma.fulfillmentRequest.findUnique({
      where: { id: fulfillmentRequestId },
      include: { items: true, searchLocation: true },
    });
    if (!request) throw new NotFoundException('Fulfillment request not found');

    const candidates = await this.candidateGenerator.generate(fulfillmentRequestId);
    const cfg = await this.config.resolve();
    const [freshMinutes, acceptableMinutes] = await Promise.all([
      this.settings.resolve('inventory.freshness.fresh_minutes').then(Number),
      this.settings.resolve('inventory.freshness.acceptable_minutes').then(Number),
    ]);
    const now = new Date();
    const drugIds = request.items.map((i) => i.drugId);

    const branches =
      candidates.eligible.length === 0
        ? []
        : await this.prisma.branch.findMany({
            where: { id: { in: candidates.eligible.map((c) => c.branchId) } },
            select: { id: true, latitude: true, longitude: true },
          });
    const branchById = new Map(branches.map((b) => [b.id, b]));

    type Scored = {
      branchId: string;
      distanceKm: number;
      coverage: ReturnType<typeof computeBranchCoverage>;
      breakdown: ReturnType<typeof scoreBranch>;
    };
    const scored: Scored[] = [];

    for (const eligible of candidates.eligible) {
      const branch = branchById.get(eligible.branchId);
      const inventoryRows = await this.inventoryProvider.getBranchInventory(eligible.branchId, drugIds);
      const rowsWithFreshness = inventoryRows.map((r) => ({
        drugId: r.drugId,
        availableQuantity: computeAvailableQuantity(
          r.onHandQuantity,
          r.reservedQuantity,
          r.blockedQuantity,
          r.damagedQuantity,
        ),
        freshness: classifyFreshness(r.sourceTimestamp, now, freshMinutes, acceptableMinutes),
      }));
      const coverage = computeBranchCoverage(
        request.items.map((i) => ({
          fulfillmentRequestItemId: i.id,
          drugId: i.drugId,
          requiredQuantity: i.requiredQuantity,
        })),
        rowsWithFreshness,
      );
      const distanceKm =
        branch?.latitude != null &&
        branch?.longitude != null &&
        request.searchLocation?.latitude != null &&
        request.searchLocation?.longitude != null
          ? haversineKm(
              request.searchLocation.latitude,
              request.searchLocation.longitude,
              branch.latitude,
              branch.longitude,
            )
          : 0;
      const breakdown = scoreBranch(
        { distanceKm, maxRelevantDistanceKm: cfg.maxRelevantDistanceKm, coverageRatio: coverage.coverageRatio, worstFreshness: coverage.worstFreshness },
        cfg.weights,
        cfg.penalties,
      );
      scored.push({ branchId: eligible.branchId, distanceKm, coverage, breakdown });
    }

    const completeBranches = scored.filter((s) => s.coverage.completeCoverage).sort((a, b) => b.breakdown.totalScore - a.breakdown.totalScore);

    return this.prisma.$transaction(async (tx) => {
      await tx.fulfillmentPlan.deleteMany({ where: { fulfillmentRequestId } });

      if (completeBranches.length > 0) {
        let rank = 1;
        for (const s of completeBranches) {
          await this.persistPlan(tx, request.id, {
            planType: 'SINGLE_BRANCH',
            rank: rank++,
            branches: [s],
            completeCoverage: true,
          });
        }
        await tx.fulfillmentRequest.update({ where: { id: request.id }, data: { status: 'OPTIONS_FOUND' } });
        return tx.fulfillmentPlan.findMany({ where: { fulfillmentRequestId }, include: PLAN_WITH_DETAIL_INCLUDE, orderBy: { rank: 'asc' } });
      }

      const splitCandidates: SplitCandidateBranch[] = scored.map((s) => ({
        branchId: s.branchId,
        score: s.breakdown.totalScore,
        availableItemIds: new Set(s.coverage.items.filter((i) => i.availabilityStatus === 'AVAILABLE').map((i) => i.fulfillmentRequestItemId)),
      }));
      const assignments = selectSplitPlan(splitCandidates, request.items.map((i) => i.id), cfg.maxSplitBranches);
      const coveredItemIds = new Set(assignments.flatMap((a) => a.itemIds));
      const allCovered = coveredItemIds.size === request.items.length;

      if (assignments.length > 0) {
        const branchesForPlan = assignments.map((a) => scored.find((s) => s.branchId === a.branchId)!);
        await this.persistPlan(tx, request.id, {
          planType: assignments.length > 1 ? 'SPLIT_BRANCH' : 'SINGLE_BRANCH',
          rank: 1,
          branches: branchesForPlan,
          completeCoverage: allCovered,
          itemsByBranch: new Map(assignments.map((a) => [a.branchId, new Set(a.itemIds)])),
        });
        await tx.fulfillmentRequest.update({
          where: { id: request.id },
          data: { status: allCovered ? 'OPTIONS_FOUND' : 'PARTIAL_OPTIONS_FOUND' },
        });
      } else {
        await tx.fulfillmentPlan.create({
          data: {
            fulfillmentRequestId: request.id,
            planType: 'NO_SAFE_PLAN',
            rank: 1,
            totalScore: 0,
            branchCount: 0,
            completeCoverage: false,
            explanationJson: {
              reason:
                candidates.eligible.length === 0
                  ? 'No eligible branches passed Stages 1-3.'
                  : 'No eligible branch or combination of branches has any of the required drugs in stock.',
              excludedBranchCount: candidates.excluded.length,
            },
          },
        });
        await tx.fulfillmentRequest.update({ where: { id: request.id }, data: { status: 'NO_OPTIONS_FOUND' } });
      }

      return tx.fulfillmentPlan.findMany({ where: { fulfillmentRequestId }, include: PLAN_WITH_DETAIL_INCLUDE, orderBy: { rank: 'asc' } });
    });
  }

  private async persistPlan(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    fulfillmentRequestId: string,
    params: {
      planType: 'SINGLE_BRANCH' | 'SPLIT_BRANCH';
      rank: number;
      branches: { branchId: string; distanceKm: number; coverage: ReturnType<typeof computeBranchCoverage>; breakdown: ReturnType<typeof scoreBranch> }[];
      completeCoverage: boolean;
      itemsByBranch?: Map<string, Set<string>>;
    },
  ) {
    const cfg = await this.config.resolve();
    const totalScore = scorePlan(
      params.branches.map((b) => b.breakdown.totalScore),
      params.completeCoverage,
      cfg.completeCoverageBonus,
      cfg.penalties.splitPerExtraBranch,
    );

    await tx.fulfillmentPlan.create({
      data: {
        fulfillmentRequestId,
        planType: params.planType,
        rank: params.rank,
        totalScore,
        branchCount: params.branches.length,
        completeCoverage: params.completeCoverage,
        totalDistanceKm: params.branches.reduce((sum, b) => sum + b.distanceKm, 0),
        explanationJson: {
          branches: params.branches.map((b) => ({ branchId: b.branchId, score: b.breakdown.totalScore, distanceKm: b.distanceKm })),
        },
        branches: {
          create: params.branches.map((b, idx) => ({
            branchId: b.branchId,
            sequence: idx + 1,
            distanceKm: b.distanceKm,
            score: b.breakdown.totalScore,
            explanationJson: { ...b.breakdown } as object,
            items: {
              create: b.coverage.items
                .filter((i) => !params.itemsByBranch || params.itemsByBranch.get(b.branchId)?.has(i.fulfillmentRequestItemId))
                .map((i) => ({
                  fulfillmentRequestItemId: i.fulfillmentRequestItemId,
                  drugId: i.drugId,
                  requestedQuantity: i.requiredQuantity,
                  availableQuantity: i.availableQuantity,
                  allocatedQuantity: i.allocatedQuantity,
                  availabilityStatus: i.availabilityStatus,
                  freshnessStatus: i.freshnessStatus,
                })),
            },
          })),
        },
      },
    });
  }
}
