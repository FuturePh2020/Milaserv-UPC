import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module';
import { TicketConfigController } from './ticket-config.controller';
import { TicketConfigService } from './ticket-config.service';

/** Ticketing engine (ADR-003). Core services/controllers are added in P2 Step 3. */
@Module({
  imports: [BranchesModule],
  controllers: [TicketConfigController],
  providers: [TicketConfigService],
  exports: [TicketConfigService],
})
export class TicketsModule {}
