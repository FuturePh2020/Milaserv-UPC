import { Module } from '@nestjs/common';
import { KbController } from './kb.controller';
import { KbContentService } from './kb-content.service';
import { CoursesService } from './courses.service';

/** Knowledge Base Basic (blueprint §10, Sprint 5). */
@Module({
  controllers: [KbController],
  providers: [KbContentService, CoursesService],
  exports: [KbContentService, CoursesService],
})
export class KbModule {}
