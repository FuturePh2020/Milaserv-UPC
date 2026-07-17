import type { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';

/**
 * Retry-queue pump (§13 / §21.1) — same in-process interval pattern as the
 * SLA and Breaks sweepers (INTEGRATION_SWEEP_INTERVAL_SECONDS, 0 = disabled;
 * tests call processDue() directly). BullMQ remains the upgrade slot.
 */
@Injectable()
export class IntegrationsSweeperService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(IntegrationsSweeperService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly integrations: IntegrationsService) {}

  onApplicationBootstrap() {
    const seconds = Number(process.env.INTEGRATION_SWEEP_INTERVAL_SECONDS ?? 30);
    if (seconds > 0) {
      this.timer = setInterval(() => {
        void this.integrations
          .processDue()
          .catch((e) => this.logger.error(`Integration sweep failed: ${e}`));
      }, seconds * 1000);
      this.timer.unref();
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}
