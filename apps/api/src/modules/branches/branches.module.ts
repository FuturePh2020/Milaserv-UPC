import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchImportService } from './branch-import.service';

/** Branch Center (blueprint §16) — master data, import, locator. */
@Module({
  imports: [SettingsModule],
  controllers: [BranchesController],
  providers: [BranchesService, BranchImportService],
  exports: [BranchesService, BranchImportService],
})
export class BranchesModule {}
