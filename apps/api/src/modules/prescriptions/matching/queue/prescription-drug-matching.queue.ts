import type { OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../../../../core/config/env';
import { ENV } from '../../../../core/config/config.module';
import { PRESCRIPTION_QUEUE_REDIS } from '../../queue/queue-redis.provider';

export const PRESCRIPTION_DRUG_MATCHING_QUEUE_NAME = 'prescription-drug-matching';

export interface PrescriptionDrugMatchingJobData {
  prescriptionId: string;
}

/**
 * CR-001 Phase 5 — one BullMQ job per prescription (design summary §20),
 * not per page: matching runs once every page has reached a terminal OCR
 * state, covering the whole prescription's medication lines together.
 * Never blocks the upload API — enqueued from
 * PrescriptionOcrWorkerService.finalizePrescriptionIfDone() after the
 * prescription itself rolls to REVIEW, the same way OCR page jobs are
 * enqueued from the upload/submit path without the HTTP response waiting
 * on them.
 */
@Injectable()
export class PrescriptionDrugMatchingQueueService implements OnModuleDestroy {
  readonly queue: Queue<PrescriptionDrugMatchingJobData>;
  readonly queueEvents: QueueEvents;

  constructor(
    @Inject(PRESCRIPTION_QUEUE_REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queue = new Queue(PRESCRIPTION_DRUG_MATCHING_QUEUE_NAME, { connection: redis });
    this.queueEvents = new QueueEvents(PRESCRIPTION_DRUG_MATCHING_QUEUE_NAME, {
      connection: redis.duplicate(),
    });
  }

  enqueuePrescription(prescriptionId: string) {
    return this.queue.add(
      'match-prescription',
      { prescriptionId },
      {
        // A fixed jobId per prescription makes a duplicate enqueue call
        // idempotent, same rationale as PrescriptionOcrQueueService.
        jobId: prescriptionId,
        attempts: this.env.PRESCRIPTION_MATCHING_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: this.env.PRESCRIPTION_MATCHING_JOB_BACKOFF_MS },
        removeOnComplete: { age: 3600, count: 1000 },
        // The retained failed set IS the dead-letter queue (design
        // summary §20) — kept for a week for an operator to inspect/retry.
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }

  async onModuleDestroy() {
    await this.queueEvents.close();
    await this.queue.close();
  }
}
