import type { OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';
import { INVENTORY_QUEUE_REDIS } from './inventory-queue-redis.provider';

export const INVENTORY_SYNC_QUEUE_NAME = 'inventory-sync';

export interface InventorySyncJobData {
  branchId: string;
  drugIds: string[];
}

/**
 * Phase 6 §13 — one job per (branch, drug-set) sync request. `jobId`
 * combines branchId with a stable hash of the sorted drugIds so a
 * duplicate sync request for the same branch+drugs is idempotent,
 * mirroring PrescriptionDrugMatchingQueueService's own rationale.
 */
@Injectable()
export class InventorySyncQueueService implements OnModuleDestroy {
  readonly queue: Queue<InventorySyncJobData>;
  readonly queueEvents: QueueEvents;

  constructor(
    @Inject(INVENTORY_QUEUE_REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queue = new Queue(INVENTORY_SYNC_QUEUE_NAME, { connection: redis });
    this.queueEvents = new QueueEvents(INVENTORY_SYNC_QUEUE_NAME, { connection: redis.duplicate() });
  }

  enqueueSync(branchId: string, drugIds: string[]) {
    const sortedKey = [...drugIds].sort().join(',');
    return this.queue.add(
      'sync-branch-inventory',
      { branchId, drugIds },
      {
        jobId: `${branchId}:${sortedKey.length}:${hashString(sortedKey)}`,
        attempts: this.env.INVENTORY_SYNC_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: this.env.INVENTORY_SYNC_JOB_BACKOFF_MS },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }

  async onModuleDestroy() {
    await this.queueEvents.close();
    await this.queue.close();
  }
}

function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}
