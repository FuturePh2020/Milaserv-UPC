import { Module, OnModuleInit } from "@nestjs/common";
import { BullModule, InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { SystemSweepProcessor, SYSTEM_SWEEP_QUEUE } from "./system-sweep.processor";
import { SettingsModule } from "../settings/settings.module";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [BullModule.registerQueue({ name: SYSTEM_SWEEP_QUEUE }), SettingsModule, AuditModule],
  providers: [SystemSweepProcessor],
})
export class JobsModule implements OnModuleInit {
  constructor(@InjectQueue(SYSTEM_SWEEP_QUEUE) private readonly queue: Queue) {}

  async onModuleInit() {
    await this.queue.add(
      "reservation-sweep",
      {},
      { repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: 50, jobId: "reservation-sweep" },
    );
    await this.queue.add(
      "inactivity-sweep",
      {},
      { repeat: { every: 60_000 }, removeOnComplete: true, removeOnFail: 50, jobId: "inactivity-sweep" },
    );
  }
}
