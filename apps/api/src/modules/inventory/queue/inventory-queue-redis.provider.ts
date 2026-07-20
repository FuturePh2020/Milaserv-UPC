import type { OnApplicationShutdown, Provider } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';

export const INVENTORY_QUEUE_REDIS = Symbol('INVENTORY_QUEUE_REDIS');

/**
 * Dedicated ioredis connection for the inventory-sync BullMQ queue —
 * separate from the shared cache-aside connection because BullMQ
 * requires `maxRetriesPerRequest: null`, mirroring
 * prescriptions/queue/queue-redis.provider.ts's own rationale exactly.
 */
export const inventoryQueueRedisProvider: Provider = {
  provide: INVENTORY_QUEUE_REDIS,
  inject: [ENV],
  useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
};

@Injectable()
export class InventoryQueueRedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(INVENTORY_QUEUE_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
