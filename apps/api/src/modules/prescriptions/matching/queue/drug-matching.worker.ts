import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { Worker } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../../../../core/config/env';
import { ENV } from '../../../../core/config/config.module';
import { PRESCRIPTION_QUEUE_REDIS } from '../../queue/queue-redis.provider';
import { DrugMatchingEngine } from '../drug-matching.engine';
import { PRESCRIPTION_DRUG_MATCHING_QUEUE_NAME } from './prescription-drug-matching.queue';
import type { PrescriptionDrugMatchingJobData } from './prescription-drug-matching.queue';

/**
 * CR-001 Phase 5 — the BullMQ consumer for `prescription-drug-matching`.
 * Thin by design: all pipeline logic lives in DrugMatchingEngine, which
 * already records its own DrugMatchRun status (including MATCHING_FAILED
 * on error) before rethrowing — this worker only needs to let BullMQ's
 * own retry/backoff take over from there, exactly mirroring
 * PrescriptionOcrWorkerService's 'failed' handler.
 */
@Injectable()
export class DrugMatchingWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DrugMatchingWorkerService.name);
  private worker: Worker<PrescriptionDrugMatchingJobData> | null = null;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(PRESCRIPTION_QUEUE_REDIS) private readonly redis: Redis,
    private readonly engine: DrugMatchingEngine,
  ) {}

  onModuleInit() {
    if (!this.env.PRESCRIPTION_MATCHING_WORKER_ENABLED) return;
    this.worker = new Worker<PrescriptionDrugMatchingJobData>(
      PRESCRIPTION_DRUG_MATCHING_QUEUE_NAME,
      (job) => this.processJob(job),
      { connection: this.redis.duplicate(), concurrency: 1 },
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const exhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
      if (exhausted) {
        this.logger.error(
          `drug matching exhausted retries for prescription ${job.data.prescriptionId}: ${err.message}`,
        );
      }
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async processJob(job: Job<PrescriptionDrugMatchingJobData>): Promise<void> {
    await this.engine.run(job.data.prescriptionId);
  }
}
