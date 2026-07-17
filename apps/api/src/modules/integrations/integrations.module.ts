import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationsSweeperService } from './integrations-sweeper.service';

/** Integration Engine foundation: Retry Queue + Monitor (§13, §21.1). */
@Module({
  imports: [SettingsModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService, IntegrationsSweeperService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
