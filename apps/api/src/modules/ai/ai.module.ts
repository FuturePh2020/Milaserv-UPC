import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AiGatewayService } from './ai-gateway.service';

/** AI readiness (blueprint §2.1) — the gateway future AI features plug into. */
@Module({
  imports: [SettingsModule],
  providers: [AiGatewayService],
  exports: [AiGatewayService],
})
export class AiModule {}
