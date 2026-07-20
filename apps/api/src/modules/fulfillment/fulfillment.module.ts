import { Module } from '@nestjs/common';
import { BranchCandidateGeneratorService } from './branch-candidate-generator.service';
import { FulfillmentRequestService } from './fulfillment-request.service';

/** Phase 6 §16-§27 — Location-Aware Fulfillment Engine. No controller
 *  yet (API endpoints land in Step 6) — Step 4 is the request/candidate
 *  foundation, exactly mirroring how Phase 5's DrugMatchingEngine was
 *  built and unit/e2e-tested a full step before its API existed. */
@Module({
  providers: [FulfillmentRequestService, BranchCandidateGeneratorService],
  exports: [FulfillmentRequestService, BranchCandidateGeneratorService],
})
export class FulfillmentModule {}
