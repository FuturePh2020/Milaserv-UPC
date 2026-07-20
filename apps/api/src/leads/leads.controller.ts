import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { LeadsService } from "./leads.service";

@ApiTags("leads")
@ApiBearerAuth()
@Controller("leads")
@UseGuards(RolesGuard)
export class LeadsController {
  constructor(private readonly leadsService: LeadsService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  findAll(@Query() query: any) {
    return this.leadsService.findAllForAdmin({
      ...query,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get("my-active")
  @Roles(UserRole.AGENT)
  findMyActive(@CurrentUser() actor: AuthenticatedUser) {
    return this.leadsService.findMyActive(actor.userId);
  }

  @Get("my-stats-today")
  @Roles(UserRole.AGENT)
  findMyStatsToday(@CurrentUser() actor: AuthenticatedUser) {
    return this.leadsService.findMyStatsToday(actor.userId);
  }

  @Put(":id/outcome")
  @Roles(UserRole.AGENT)
  updateOutcome(@Param("id") id: string, @Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.leadsService.updateOutcome(id, actor.userId, body);
  }

  @Post(":id/reassign")
  @Roles(UserRole.ADMIN)
  reassign(
    @Param("id") id: string,
    @Body("newAgentId") newAgentId: string,
    @Body("reason") reason: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.leadsService.adminReassign(id, newAgentId, actor.userId, reason);
  }

  @Post(":id/return-to-pool")
  @Roles(UserRole.ADMIN)
  returnToPool(@Param("id") id: string, @Body("reason") reason: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.leadsService.adminReturnToPool(id, actor.userId, reason);
  }

  @Put(":id/mark-status")
  @Roles(UserRole.ADMIN)
  markStatus(
    @Param("id") id: string,
    @Body("status") status: string,
    @Body("notes") notes: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.leadsService.adminMarkStatus(id, status, actor.userId, notes);
  }
}
