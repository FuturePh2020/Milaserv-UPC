import type { OnModuleDestroy } from '@nestjs/common';
import { Inject, Injectable } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import type Redis from 'ioredis';
import type { Env } from '../../../core/config/env';
import { ENV } from '../../../core/config/config.module';
import { PRESCRIPTION_QUEUE_REDIS } from './queue-redis.provider';

export const PRESCRIPTION_OCR_QUEUE_NAME = 'prescription-ocr';

export interface PrescriptionOcrJobData {
  pageId: string;
}

/**
 * One BullMQ job per page (design spec §1/§5.1) — not per pipeline stage;
 * a page's stages run sequentially inside one job, so a retry re-runs the
 * whole page rather than requiring cross-stage checkpointing.
 */
@Injectable()
export class PrescriptionOcrQueueService implements OnModuleDestroy {
  readonly queue: Queue<PrescriptionOcrJobData>;
  readonly queueEvents: QueueEvents;

  constructor(
    @Inject(PRESCRIPTION_QUEUE_REDIS) redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.queue = new Queue(PRESCRIPTION_OCR_QUEUE_NAME, { connection: redis });
    this.queueEvents = new QueueEvents(PRESCRIPTION_OCR_QUEUE_NAME, {
      connection: redis.duplicate(),
    });
  }

  enqueuePage(pageId: string) {
    return this.queue.add(
      'process-page',
      { pageId },
      {
        // A fixed jobId per page makes a duplicate enqueuePage() call
        // (e.g. a retried HTTP request) idempotent — BullMQ returns the
        // existing waiting/active job instead of stacking a second one.
        // Safe to reuse across a page's lifetime: once the prior job
        // completes/fails it's removed (below), freeing the id for a
        // later legitimate re-enqueue.
        jobId: pageId,
        attempts: this.env.PRESCRIPTION_OCR_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: this.env.PRESCRIPTION_OCR_JOB_BACKOFF_MS },
        removeOnComplete: { age: 3600, count: 1000 },
        // The retained failed set IS the dead-letter queue (design spec
        // §1/§10) — kept for a week so an operator can inspect/retry.
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    );
  }

  async onModuleDestroy() {
    await this.queueEvents.close();
    await this.queue.close();
  }
}
