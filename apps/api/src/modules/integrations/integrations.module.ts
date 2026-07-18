import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { OnlineModule } from '../online/online.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { IntegrationsSweeperService } from './integrations-sweeper.service';
import { ConnectorsController } from './connectors.controller';
import { ConnectorsService } from './connectors.service';

/** Integration Engine foundation: Retry Queue + Monitor (§13, §21.1). */
@Module({
  imports: [SettingsModule, OnlineModule],
  controllers: [IntegrationsController, ConnectorsController],
  providers: [IntegrationsService, IntegrationsSweeperService, ConnectorsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
