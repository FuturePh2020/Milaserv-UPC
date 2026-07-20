import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SettingsModule } from '../settings/settings.module';
import { BranchCandidateGeneratorService } from './branch-candidate-generator.service';
import { FulfillmentConfigService } from './fulfillment-config.service';
import { FulfillmentController } from './fulfillment.controller';
import { FulfillmentPlanGeneratorService } from './fulfillment-plan-generator.service';
import { FulfillmentPlanSelectionService } from './fulfillment-plan-selection.service';
import { FulfillmentRequestService } from './fulfillment-request.service';

/** Phase 6 §16-§27 — Location-Aware Fulfillment Engine: request/
 *  candidate/ranking foundation (Steps 4-5) plus the API surface and
 *  InventoryReservation confirm action (Step 6). SettingsModule/
 *  InventoryModule aren't @Global, so they must be imported directly
 *  for FulfillmentConfigService and FulfillmentPlanGeneratorService to
 *  resolve. */
@Module({
  imports: [SettingsModule, InventoryModule],
  controllers: [FulfillmentController],
  providers: [
    FulfillmentRequestService,
    BranchCandidateGeneratorService,
    FulfillmentConfigService,
    FulfillmentPlanGeneratorService,
    FulfillmentPlanSelectionService,
  ],
  exports: [
    FulfillmentRequestService,
    BranchCandidateGeneratorService,
    FulfillmentConfigService,
    FulfillmentPlanGeneratorService,
    FulfillmentPlanSelectionService,
  ],
})
export class FulfillmentModule {}
