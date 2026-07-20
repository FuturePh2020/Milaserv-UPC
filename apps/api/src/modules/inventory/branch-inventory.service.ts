import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { CachedInventoryProvider } from './cached-inventory.provider';
import { classifyFreshness, classifyInventoryStatus, computeAvailableQuantity } from './inventory-calculations';
import { INVENTORY_PROVIDER } from './inventory-provider.interface';
import type { InventoryProvider } from './inventory-provider.interface';

/**
 * Phase 6 §12/§13/§14 — owns writing InventoryProvider snapshots into
 * BranchInventory (the persisted source of truth the fulfillment engine
 * queries) and reading them back with freshness classification applied.
 * The cache is TTL-bounded (Settings-driven, default 120s) rather than
 * explicitly invalidated on every sync — acceptable staleness for a
 * foundation whose only provider today is the mock; a real SAP
 * provider's sync cadence would dominate over this margin anyway.
 */
@Injectable()
export class BranchInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(INVENTORY_PROVIDER) private readonly provider: InventoryProvider,
    private readonly cache: CachedInventoryProvider,
    private readonly settings: SettingsService,
  ) {}

  async syncBranch(branchId: string, drugIds: string[]): Promise<{ synced: number; providerName: string }> {
    const branch = await this.prisma.branch.findFirst({ where: { id: branchId, deletedAt: null } });
    if (!branch) throw new NotFoundException('Branch not found');

    const items = await this.provider.getBranchInventory(branchId, drugIds);
    for (const item of items) {
      const availableQuantity = computeAvailableQuantity(
        item.onHandQuantity,
        item.reservedQuantity,
        item.blockedQuantity,
        item.damagedQuantity,
      );
      const inventoryStatus =
        item.explicitStatus ?? classifyInventoryStatus(availableQuantity, item.safetyStockQuantity, false);
      const data = {
        sapMaterialNumber: item.sapMaterialNumber,
        onHandQuantity: item.onHandQuantity,
        availableQuantity,
        reservedQuantity: item.reservedQuantity,
        blockedQuantity: item.blockedQuantity,
        damagedQuantity: item.damagedQuantity,
        inTransitQuantity: item.inTransitQuantity,
        safetyStockQuantity: item.safetyStockQuantity,
        expectedRestockQuantity: item.expectedRestockQuantity,
        expectedRestockAt: item.expectedRestockAt,
        batchCount: item.batchCount,
        earliestExpiryDate: item.earliestExpiryDate,
        inventoryStatus,
        sourceSystem: this.provider.name,
        sourceTimestamp: item.sourceTimestamp,
        receivedAt: new Date(),
        active: true,
      };
      await this.prisma.branchInventory.upsert({
        where: { branchId_drugId: { branchId: item.branchId, drugId: item.drugId } },
        update: data,
        create: { branchId: item.branchId, drugId: item.drugId, ...data },
      });
    }
    await this.cache.invalidateAll();
    return { synced: items.length, providerName: this.provider.name };
  }

  async getBranchInventory(branchId: string) {
    const [rows, freshMinutes, acceptableMinutes] = await Promise.all([
      this.prisma.branchInventory.findMany({
        where: { branchId, active: true },
        include: { drug: { select: { nameEn: true, nameAr: true, materialNo: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
      this.settings.resolve('inventory.freshness.fresh_minutes').then(Number),
      this.settings.resolve('inventory.freshness.acceptable_minutes').then(Number),
    ]);
    const now = new Date();
    return rows.map((row) => ({
      ...row,
      freshness: classifyFreshness(row.sourceTimestamp, now, freshMinutes, acceptableMinutes),
    }));
  }
}
