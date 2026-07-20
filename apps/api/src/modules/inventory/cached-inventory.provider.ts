import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../core/redis/redis.module';
import { SettingsService } from '../settings/settings.service';
import type { InventoryProvider, InventorySnapshotItem } from './inventory-provider.interface';

const CACHE_VERSION_KEY = 'inventory:cache:version';

function reviveItem(raw: InventorySnapshotItem): InventorySnapshotItem {
  return {
    ...raw,
    sourceTimestamp: new Date(raw.sourceTimestamp),
    expectedRestockAt: raw.expectedRestockAt ? new Date(raw.expectedRestockAt) : null,
    earliestExpiryDate: raw.earliestExpiryDate ? new Date(raw.earliestExpiryDate) : null,
  };
}

/**
 * Phase 6 §13 — Redis cache-aside wrapper around any InventoryProvider,
 * following permissions.service.ts's established pattern exactly:
 * version-prefixed keys for cheap bulk invalidation, every Redis call
 * wrapped in .catch() so a Redis outage falls back to calling the
 * wrapped provider directly rather than breaking fulfillment search.
 * TTL is Settings-driven (ADR-008), not hard-coded.
 */
@Injectable()
export class CachedInventoryProvider implements InventoryProvider {
  constructor(
    private readonly inner: InventoryProvider,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly settings: SettingsService,
  ) {}

  /** Caching is a transport-layer detail, not a distinct source system
   *  — callers that persist `name` (e.g. BranchInventory.sourceSystem)
   *  should see the real origin, not a wrapper artifact. */
  get name(): string {
    return this.inner.name;
  }

  private async ttlSeconds(): Promise<number> {
    return Number(await this.settings.resolve('inventory.cache.ttl_seconds').catch(() => 120));
  }

  private async cacheKey(parts: (string | string[])[]): Promise<string> {
    const version = (await this.redis.get(CACHE_VERSION_KEY).catch(() => null)) ?? '0';
    const flat = parts.map((p) => (Array.isArray(p) ? [...p].sort().join(',') : p)).join('|');
    return `inventory:${version}:${flat}`;
  }

  private async withCache(
    keyParts: (string | string[])[],
    fetch: () => Promise<InventorySnapshotItem[]>,
  ): Promise<InventorySnapshotItem[]> {
    const key = await this.cacheKey(keyParts);
    const cached = await this.redis.get(key).catch(() => null);
    if (cached) {
      try {
        return (JSON.parse(cached) as InventorySnapshotItem[]).map(reviveItem);
      } catch {
        // Corrupt cache entry — fall through to a real fetch.
      }
    }
    const result = await fetch();
    const ttl = await this.ttlSeconds();
    await this.redis.set(key, JSON.stringify(result), 'EX', ttl).catch(() => undefined);
    return result;
  }

  getBranchInventory(branchId: string, drugIds: string[] = []): Promise<InventorySnapshotItem[]> {
    return this.withCache(['branch', branchId, drugIds], () => this.inner.getBranchInventory(branchId, drugIds));
  }

  getMultiBranchInventory(branchIds: string[], drugIds: string[]): Promise<InventorySnapshotItem[]> {
    return this.withCache(['multi', branchIds, drugIds], () =>
      this.inner.getMultiBranchInventory(branchIds, drugIds),
    );
  }

  getDrugAvailability(drugId: string, branchIds: string[]): Promise<InventorySnapshotItem[]> {
    return this.withCache(['drug', drugId, branchIds], () => this.inner.getDrugAvailability(drugId, branchIds));
  }

  getInventorySnapshot(branchId: string): Promise<InventorySnapshotItem[]> {
    return this.withCache(['snapshot', branchId], () => this.inner.getInventorySnapshot(branchId));
  }

  getInventoryFreshness(branchId: string): Promise<{ sourceTimestamp: Date | null }> {
    return this.inner.getInventoryFreshness(branchId);
  }

  healthCheck(): Promise<boolean> {
    return this.inner.healthCheck();
  }

  /** Bumps the cache version, invalidating every cached entry cheaply —
   *  called after a sync writes fresher data than what might be cached. */
  async invalidateAll(): Promise<void> {
    await this.redis.incr(CACHE_VERSION_KEY).catch(() => undefined);
  }
}
