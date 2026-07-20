import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module';
import { SettingsModule } from '../settings/settings.module';
import { BranchCandidateGeneratorService } from './branch-candidate-generator.service';
import { FulfillmentConfigService } from './fulfillment-config.service';
import { FulfillmentPlanGeneratorService } from './fulfillment-plan-generator.service';
import { FulfillmentRequestService } from './fulfillment-request.service';

/** Phase 6 §16-§27 — Location-Aware Fulfillment Engine. No controller
 *  yet (API endpoints land in Step 6) — Step 4/5 are the request/
 *  candidate/ranking foundation, exactly mirroring how Phase 5's
 *  DrugMatchingEngine was built and unit/e2e-tested a full step before
 *  its API existed. SettingsModule/InventoryModule aren't @Global, so
 *  they must be imported directly for FulfillmentConfigService and
 *  FulfillmentPlanGeneratorService to resolve. */
@Module({
  imports: [SettingsModule, InventoryModule],
  providers: [
    FulfillmentRequestService,
    BranchCandidateGeneratorService,
    FulfillmentConfigService,
    FulfillmentPlanGeneratorService,
  ],
  exports: [
    FulfillmentRequestService,
    BranchCandidateGeneratorService,
    FulfillmentConfigService,
    FulfillmentPlanGeneratorService,
  ],
})
export class FulfillmentModule {}
