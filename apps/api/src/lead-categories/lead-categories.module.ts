import { Module } from "@nestjs/common";
import { LeadCategoriesService } from "./lead-categories.service";
import { LeadCategoriesController } from "./lead-categories.controller";

@Module({
  providers: [LeadCategoriesService],
  controllers: [LeadCategoriesController],
  exports: [LeadCategoriesService],
})
export class LeadCategoriesModule {}
