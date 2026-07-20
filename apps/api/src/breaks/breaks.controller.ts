import { Body, Controller, Get, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { BreaksService } from "./breaks.service";

@ApiTags("breaks")
@ApiBearerAuth()
@Controller("breaks")
@UseGuards(RolesGuard)
export class BreaksController {
  constructor(private readonly breaksService: BreaksService) {}

  @Get("types")
  listTypes() {
    return this.breaksService.listTypes();
  }

  @Post("types")
  @Roles(UserRole.ADMIN)
  createType(@Body() body: any) {
    return this.breaksService.createType(body);
  }

  @Put("types/:id")
  @Roles(UserRole.ADMIN)
  updateType(@Param("id") id: string, @Body() body: any) {
    return this.breaksService.updateType(id, body);
  }

  @Put("types/:id/task-limits/:taskId")
  @Roles(UserRole.ADMIN)
  setTaskLimit(
    @Param("id") id: string,
    @Param("taskId") taskId: string,
    @Body("maxConcurrentAgents") maxConcurrentAgents: number,
  ) {
    return this.breaksService.setTaskLimit(id, taskId, maxConcurrentAgents);
  }

  @Post("start")
  @Roles(UserRole.AGENT)
  start(@Body("breakTypeId") breakTypeId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.breaksService.start({ userId: actor.userId, breakTypeId, source: "AGENT" });
  }

  @Post("end")
  @Roles(UserRole.AGENT)
  end(@CurrentUser() actor: AuthenticatedUser) {
    return this.breaksService.end(actor.userId);
  }

  @Post("resume")
  @Roles(UserRole.AGENT)
  resume(@CurrentUser() actor: AuthenticatedUser) {
    return this.breaksService.resume(actor.userId);
  }

  @Get("my-today")
  @Roles(UserRole.AGENT)
  myToday(@CurrentUser() actor: AuthenticatedUser) {
    return this.breaksService.myToday(actor.userId);
  }

  @Get("live-monitor")
  @Roles(UserRole.ADMIN)
  liveMonitor() {
    return this.breaksService.liveMonitor();
  }

  @Post("admin/:userId/start")
  @Roles(UserRole.ADMIN)
  adminStart(
    @Param("userId") userId: string,
    @Body("breakTypeId") breakTypeId: string,
    @Body("overrideReason") overrideReason: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.breaksService.start({
      userId,
      breakTypeId,
      source: "ADMIN",
      overrideReason,
      overriddenByUserId: overrideReason ? actor.userId : undefined,
    });
  }

  @Post("admin/:userId/end")
  @Roles(UserRole.ADMIN)
  adminEnd(@Param("userId") userId: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.breaksService.end(userId, actor.userId);
  }

  @Put("admin/:id/correct")
  @Roles(UserRole.ADMIN)
  adminCorrect(
    @Param("id") id: string,
    @Body("reason") reason: string,
    @Body("data") data: Record<string, unknown>,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.breaksService.adminCorrect(id, data, reason, actor.userId);
  }
}
