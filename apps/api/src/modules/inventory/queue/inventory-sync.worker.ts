import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';
import { BranchInventoryService } from '../branch-inventory.service';
import { INVENTORY_QUEUE_REDIS } from './inventory-queue-redis.provider';
import { INVENTORY_SYNC_QUEUE_NAME } from './inventory-sync.queue';
import type { InventorySyncJobData } from './inventory-sync.queue';

/**
 * Phase 6 §13 — thin BullMQ consumer for `inventory-sync`, mirroring
 * DrugMatchingWorkerService: all real logic lives in
 * BranchInventoryService.syncBranch(); this worker only lets BullMQ's
 * retry/backoff take over on failure.
 */
@Injectable()
export class InventorySyncWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventorySyncWorkerService.name);
  private worker: Worker<InventorySyncJobData> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(INVENTORY_QUEUE_REDIS) private readonly redis: Redis,
    private readonly inventory: BranchInventoryService,
  ) {}

  onModuleInit() {
    if (!this.env.INVENTORY_SYNC_WORKER_ENABLED) return;
    this.worker = new Worker<InventorySyncJobData>(
      INVENTORY_SYNC_QUEUE_NAME,
      (job) => this.processJob(job),
      { connection: this.redis.duplicate(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (exhausted) {
        this.logger.error(`inventory sync exhausted retries for branch ${job.data.branchId}: ${err.message}`);
      }
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async processJob(job: Job<InventorySyncJobData>): Promise<void> {
    await this.inventory.syncBranch(job.data.branchId, job.data.drugIds);
  }
}
