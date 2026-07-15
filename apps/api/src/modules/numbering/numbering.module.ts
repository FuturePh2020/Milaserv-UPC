import { Global, Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { NumberingService } from './numbering.service';

@Global()
@Module({
  imports: [SettingsModule],
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
