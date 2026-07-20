import { Module } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS } from '../../core/redis/redis.module';
import { SettingsModule } from '../settings/settings.module';
import { SettingsService } from '../settings/settings.service';
import { BranchInventoryService } from './branch-inventory.service';
import { CachedInventoryProvider } from './cached-inventory.provider';
import { InventoryController } from './inventory.controller';
import { INVENTORY_PROVIDER } from './inventory-provider.interface';
import { MockInventoryProvider } from './mock-inventory.provider';
import { InventoryQueueRedisShutdown, inventoryQueueRedisProvider } from './queue/inventory-queue-redis.provider';
import { InventorySyncQueueService } from './queue/inventory-sync.queue';
import { InventorySyncWorkerService } from './queue/inventory-sync.worker';

/**
 * Phase 6 §11-§14 — Branch Inventory. `MockInventoryProvider` is the
 * only real implementation today (no SAP contract exists yet, per the
 * Step 6 kickoff decision); `CachedInventoryProvider` wraps it and is
 * bound to both its own class token (so BranchInventoryService can call
 * invalidateAll()) and the generic INVENTORY_PROVIDER interface token
 * (so future consumers — the fulfillment engine — depend on the
 * abstraction, not a concrete implementation) via `useExisting`, which
 * aliases both tokens to the same singleton instance.
 */
@Module({
  imports: [SettingsModule],
  controllers: [InventoryController],
  providers: [
    MockInventoryProvider,
    {
      provide: CachedInventoryProvider,
      inject: [MockInventoryProvider, REDIS, SettingsService],
      useFactory: (mock: MockInventoryProvider, redis: Redis, settings: SettingsService) =>
        new CachedInventoryProvider(mock, redis, settings),
    },
    { provide: INVENTORY_PROVIDER, useExisting: CachedInventoryProvider },
    BranchInventoryService,
    inventoryQueueRedisProvider,
    InventoryQueueRedisShutdown,
    InventorySyncQueueService,
    InventorySyncWorkerService,
  ],
  exports: [BranchInventoryService, INVENTORY_PROVIDER, InventorySyncQueueService],
})
export class InventoryModule {}
