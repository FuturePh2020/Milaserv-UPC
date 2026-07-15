import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { SettingsModule } from '../settings/settings.module';
import { TicketConfigController } from './ticket-config.controller';
import { TicketConfigService } from './ticket-config.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { SlaSweeperService } from './sla-sweeper.service';

/** Ticketing engine (ADR-003): universal tickets for all teams. */
@Module({
  imports: [BranchesModule, SettingsModule],
  controllers: [TicketsController, TicketConfigController],
  providers: [TicketsService, TicketConfigService, SlaSweeperService],
  exports: [TicketsService, TicketConfigService, SlaSweeperService],
})
export class TicketsModule {}
