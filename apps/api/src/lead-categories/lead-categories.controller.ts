import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { LeadCategoriesService } from "./lead-categories.service";

@ApiTags("lead-categories")
@ApiBearerAuth()
@Controller("lead-categories")
@UseGuards(RolesGuard)
export class LeadCategoriesController {
  constructor(private readonly service: LeadCategoriesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body() body: any) {
    return this.service.create(body);
  }

  @Put(":id")
  @Roles(UserRole.ADMIN)
  update(@Param("id") id: string, @Body() body: any) {
    return this.service.update(id, body);
  }
}
