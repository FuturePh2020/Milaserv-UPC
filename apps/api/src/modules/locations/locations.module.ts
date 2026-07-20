import { Module } from '@nestjs/common';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

/** Phase 6 — Location-Aware Branch Inventory & Fulfillment Engine:
 *  Region/City/District/LocationAlias hierarchy + Branch backfill. */
@Module({
  controllers: [LocationsController],
  providers: [LocationsService],
  exports: [LocationsService],
})
export class LocationsModule {}
