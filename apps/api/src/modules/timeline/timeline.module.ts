import { Global, Module } from '@nestjs/common';
import { TimelineService } from './timeline.service';

@Global()
@Module({
  providers: [TimelineService],
  exports: [TimelineService],
})
export class TimelineModule {}
