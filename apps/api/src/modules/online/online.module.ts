import { Module } from '@nestjs/common';
import { OnlineController } from './online.controller';
import { OnlineService } from './online.service';

/** Online Operation & Ordering (blueprint §13). */
@Module({
  controllers: [OnlineController],
  providers: [OnlineService],
  exports: [OnlineService],
})
export class OnlineModule {}
