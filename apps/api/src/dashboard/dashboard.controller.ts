import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { DashboardService } from "./dashboard.service";

@ApiTags("dashboard")
@ApiBearerAuth()
@Controller("dashboard")
@UseGuards(RolesGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("admin/summary")
  @Roles(UserRole.ADMIN)
  adminSummary() {
    return this.dashboardService.adminSummary();
  }

  @Get("admin/charts/leads-by-partner")
  @Roles(UserRole.ADMIN)
  leadsByPartner() {
    return this.dashboardService.leadsByPartner();
  }

  @Get("admin/charts/leads-by-category")
  @Roles(UserRole.ADMIN)
  leadsByCategory() {
    return this.dashboardService.leadsByCategory();
  }

  @Get("admin/charts/leads-by-status")
  @Roles(UserRole.ADMIN)
  leadsByStatus() {
    return this.dashboardService.leadsByStatus();
  }

  @Get("admin/charts/leads-by-task")
  @Roles(UserRole.ADMIN)
  leadsByTask() {
    return this.dashboardService.leadsByTask();
  }

  @Get("agent/summary")
  @Roles(UserRole.AGENT)
  agentSummary(@CurrentUser() actor: AuthenticatedUser) {
    return this.dashboardService.agentSummary(actor.userId);
  }
}
