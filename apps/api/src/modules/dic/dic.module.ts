import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { DicController } from './dic.controller';
import { DicService } from './dic.service';
import { DicImportService } from './dic-import.service';

/** United Pharmacy Center — DIC (blueprint §15). */
@Module({
  imports: [SettingsModule, IntegrationsModule],
  controllers: [DicController],
  providers: [DicService, DicImportService],
  exports: [DicService, DicImportService],
})
export class DicModule {}
