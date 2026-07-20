import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { SessionsService } from "./sessions.service";

@ApiTags("sessions")
@ApiBearerAuth()
@Controller("sessions")
@UseGuards(RolesGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post("start")
  @Roles(UserRole.AGENT)
  start(@CurrentUser() actor: AuthenticatedUser) {
    return this.sessionsService.start(actor.userId);
  }

  @Post("end")
  @Roles(UserRole.AGENT)
  end(@CurrentUser() actor: AuthenticatedUser) {
    return this.sessionsService.end(actor.userId);
  }

  @Get("active")
  @Roles(UserRole.AGENT)
  getActive(@CurrentUser() actor: AuthenticatedUser) {
    return this.sessionsService.getActive(actor.userId);
  }

  @Post("heartbeat")
  @Roles(UserRole.AGENT)
  heartbeat(@CurrentUser() actor: AuthenticatedUser) {
    return this.sessionsService.heartbeat(actor.userId);
  }

  @Put("status")
  @Roles(UserRole.AGENT)
  setStatus(@Body("status") status: "AVAILABLE" | "OFFLINE", @CurrentUser() actor: AuthenticatedUser) {
    return this.sessionsService.setManualStatus(actor.userId, status);
  }

  @Get("history")
  @Roles(UserRole.AGENT)
  history(@CurrentUser() actor: AuthenticatedUser) {
    return this.sessionsService.history(actor.userId);
  }

  @Get("admin/active")
  @Roles(UserRole.ADMIN)
  listActive() {
    return this.sessionsService.listActive();
  }

  @Post("admin/:id/end")
  @Roles(UserRole.ADMIN)
  adminEnd(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.sessionsService.adminEnd(id, actor.userId);
  }

  @Put("admin/:id/correct")
  @Roles(UserRole.ADMIN)
  adminCorrect(
    @Param("id") id: string,
    @Body("reason") reason: string,
    @Body("data") data: Record<string, unknown>,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.sessionsService.adminCorrect(id, data, reason, actor.userId);
  }
}
