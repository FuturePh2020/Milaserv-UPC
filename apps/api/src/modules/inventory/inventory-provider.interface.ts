import type { InventoryStatusValue } from './inventory-calculations';

/**
 * Phase 6 §12 — one branch/drug stock reading from an external source.
 * Quantities are nullable ("unknown"), never fabricated when a source
 * can't report them.
 */
export interface InventorySnapshotItem {
  branchId: string;
  drugId: string;
  sapMaterialNumber: string;
  onHandQuantity: number | null;
  reservedQuantity: number | null;
  blockedQuantity: number | null;
  damagedQuantity: number | null;
  inTransitQuantity: number | null;
  safetyStockQuantity: number | null;
  expectedRestockQuantity: number | null;
  expectedRestockAt: Date | null;
  batchCount: number | null;
  earliestExpiryDate: Date | null;
  /** Set only when the source system reports an explicit status
   *  (e.g. BLOCKED, IN_TRANSIT) that quantity-based classification
   *  can't infer — null lets the caller fall back to
   *  classifyInventoryStatus(). */
  explicitStatus: InventoryStatusValue | null;
  sourceTimestamp: Date;
}

/**
 * Phase 6 §12 — swappable inventory backend, mirroring this codebase's
 * NotificationChannel interface pattern (one interface, several
 * implementations toggled without touching call sites). Milaserv360
 * business logic depends only on this interface, never on one
 * external system's response shape.
 */
export interface InventoryProvider {
  readonly name: string;

  getBranchInventory(branchId: string, drugIds?: string[]): Promise<InventorySnapshotItem[]>;

  getMultiBranchInventory(branchIds: string[], drugIds: string[]): Promise<InventorySnapshotItem[]>;

  getDrugAvailability(drugId: string, branchIds: string[]): Promise<InventorySnapshotItem[]>;

  getInventorySnapshot(branchId: string): Promise<InventorySnapshotItem[]>;

  /** null when the branch has no snapshot at all yet. */
  getInventoryFreshness(branchId: string): Promise<{ sourceTimestamp: Date | null }>;

  healthCheck(): Promise<boolean>;
}

export const INVENTORY_PROVIDER = Symbol('INVENTORY_PROVIDER');
