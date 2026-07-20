import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { InventoryProvider, InventorySnapshotItem } from './inventory-provider.interface';

/** djb2 — small, dependency-free, deterministic string hash. */
function hashString(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return hash >>> 0;
}

/**
 * Phase 6 §12 — dev/test stand-in for a real SAP (or other ERP)
 * inventory API. No real SAP contract exists in this repo yet (per
 * Step 6 kickoff decision) — this provider exists so the rest of the
 * fulfillment engine can be built and tested against a working
 * InventoryProvider today, and swapped for a real implementation later
 * with zero call-site changes.
 *
 * Generates deterministic (not random) quantities per (branchId,
 * drugId) pair — the same pair always produces the same numbers within
 * a process, which makes tests reproducible. It never claims knowledge
 * of "every drug a branch stocks" (getInventorySnapshot returns []) —
 * only of pairs it's explicitly asked about, matching how a real batch
 * inventory endpoint is actually queried (never a full-catalog dump).
 */
@Injectable()
export class MockInventoryProvider implements InventoryProvider {
  readonly name = 'mock';

  constructor(private readonly prisma: PrismaService) {}

  private async buildItem(branchId: string, drugId: string): Promise<InventorySnapshotItem | null> {
    const drug = await this.prisma.drug.findUnique({
      where: { id: drugId },
      select: { materialNo: true, discontinued: true },
    });
    if (!drug) return null;

    const seed = hashString(`${branchId}:${drugId}`);
    const onHandQuantity = seed % 200;
    const reservedQuantity = seed % 11;
    const blockedQuantity = seed % 23 === 0 ? seed % 5 : 0;
    const damagedQuantity = seed % 37 === 0 ? 1 : 0;

    return {
      branchId,
      drugId,
      sapMaterialNumber: drug.materialNo,
      onHandQuantity,
      reservedQuantity,
      blockedQuantity,
      damagedQuantity,
      inTransitQuantity: seed % 41 === 0 ? seed % 15 : 0,
      safetyStockQuantity: 10,
      expectedRestockQuantity: null,
      expectedRestockAt: null,
      batchCount: onHandQuantity > 0 ? 1 + (seed % 3) : 0,
      earliestExpiryDate: null,
      explicitStatus: drug.discontinued ? 'DISCONTINUED' : null,
      sourceTimestamp: new Date(),
    };
  }

  async getBranchInventory(branchId: string, drugIds: string[] = []): Promise<InventorySnapshotItem[]> {
    const items = await Promise.all(drugIds.map((drugId) => this.buildItem(branchId, drugId)));
    return items.filter((i): i is InventorySnapshotItem => i !== null);
  }

  async getMultiBranchInventory(branchIds: string[], drugIds: string[]): Promise<InventorySnapshotItem[]> {
    const all = await Promise.all(branchIds.map((branchId) => this.getBranchInventory(branchId, drugIds)));
    return all.flat();
  }

  async getDrugAvailability(drugId: string, branchIds: string[]): Promise<InventorySnapshotItem[]> {
    const items = await Promise.all(branchIds.map((branchId) => this.buildItem(branchId, drugId)));
    return items.filter((i): i is InventorySnapshotItem => i !== null);
  }

  async getInventorySnapshot(): Promise<InventorySnapshotItem[]> {
    return [];
  }

  async getInventoryFreshness(): Promise<{ sourceTimestamp: Date | null }> {
    return { sourceTimestamp: new Date() };
  }

  async healthCheck(): Promise<boolean> {
    return true;
  }
}
