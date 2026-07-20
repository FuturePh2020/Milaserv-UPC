import type { OnApplicationShutdown, Provider } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';

export const PRESCRIPTION_QUEUE_REDIS = Symbol('PRESCRIPTION_QUEUE_REDIS');

/**
 * Dedicated ioredis connection for BullMQ — separate from the shared
 * permission-cache connection in core/redis because BullMQ requires
 * `maxRetriesPerRequest: null`, which is the wrong setting for everything
 * else that uses Redis in this app.
 */
export const prescriptionQueueRedisProvider: Provider = {
  provide: PRESCRIPTION_QUEUE_REDIS,
  inject: [ENV],
  useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
};

@Injectable()
export class PrescriptionQueueRedisShutdown implements OnApplicationShutdown {
  constructor(@Inject(PRESCRIPTION_QUEUE_REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}
