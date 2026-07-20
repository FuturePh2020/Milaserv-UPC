import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { TimelineService } from "./timeline.service";

@ApiTags("timeline")
@ApiBearerAuth()
@Controller("timeline")
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  forEntity(@Query("entityType") entityType: string, @Query("entityId") entityId: string) {
    return this.timelineService.forEntity(entityType, entityId);
  }
}
