import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';

/** Customer Care performance & targets (blueprint §12.1/§12.2, Sprint 7). */
@Module({
  imports: [SettingsModule],
  controllers: [PerformanceController],
  providers: [PerformanceService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
