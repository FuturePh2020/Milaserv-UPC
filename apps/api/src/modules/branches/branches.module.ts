import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { BranchesController } from './branches.controller';
import { BranchesService } from './branches.service';
import { BranchImportService } from './branch-import.service';
import { BranchExtensionsController } from './branch-extensions.controller';
import { BranchExtensionsService } from './branch-extensions.service';

/**
 * Branch Center (blueprint §16) — master data, import, locator, and
 * (Phase 6) the operational-extension sub-resources the fulfillment
 * engine reads. BranchExtensionsController is registered BEFORE
 * BranchesController: its literal `/branches/capabilities` route must
 * be matched before BranchesController's `/branches/:id` wildcard —
 * controller order in this array is route-registration order.
 */
@Module({
  imports: [SettingsModule],
  controllers: [BranchExtensionsController, BranchesController],
  providers: [BranchesService, BranchImportService, BranchExtensionsService],
  exports: [BranchesService, BranchImportService, BranchExtensionsService],
})
export class BranchesModule {}
