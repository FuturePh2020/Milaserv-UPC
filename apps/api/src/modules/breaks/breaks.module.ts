import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BreaksController } from './breaks.controller';
import { BreaksService } from './breaks.service';
import { BreaksSweeperService } from './breaks-sweeper.service';

/** Break Tracker & Workforce (blueprint §11, Sprint 6). */
@Module({
  imports: [SettingsModule],
  controllers: [BreaksController],
  providers: [BreaksService, BreaksSweeperService],
  exports: [BreaksService, BreaksSweeperService],
})
export class BreaksModule {}
