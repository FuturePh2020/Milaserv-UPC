import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { RequestMeta, RequestMeta as RequestMetaType } from "../common/decorators/request-meta.decorator";
import { AuditService } from "../audit/audit.service";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  findAll(
    @Query("role") role?: string,
    @Query("status") status?: string,
    @Query("teamId") teamId?: string,
    @Query("search") search?: string,
  ) {
    return this.usersService.findAll({ role, status, teamId, search });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  async create(@Body() body: any, @CurrentUser() actor: AuthenticatedUser, @RequestMeta() meta: RequestMetaType) {
    const user = await this.usersService.create(body);
    await this.audit.log({
      action: "USER_CREATE",
      userId: actor.userId,
      entityType: "User",
      entityId: user.id,
      metadata: { username: user.username, role: user.role },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return user;
  }

  @Put(":id")
  async update(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const user = await this.usersService.update(id, body);
    await this.audit.log({
      action: "USER_UPDATE",
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      metadata: body,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return user;
  }

  @Put(":id/status")
  async setStatus(
    @Param("id") id: string,
    @Body("status") status: "ACTIVE" | "SUSPENDED" | "LOCKED",
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const user = await this.usersService.setStatus(id, status);
    await this.audit.log({
      action: "USER_UPDATE",
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      metadata: { status },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return user;
  }

  @Post(":id/reset-password")
  async resetPassword(
    @Param("id") id: string,
    @Body("newPassword") newPassword: string,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const result = await this.usersService.resetPassword(id, newPassword);
    await this.audit.log({
      action: "USER_PASSWORD_RESET",
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return result;
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser, @RequestMeta() meta: RequestMetaType) {
    const result = await this.usersService.delete(id);
    await this.audit.log({
      action: "USER_DELETE",
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return result;
  }

  @Put(":id/task-permissions")
  async setTaskPermissions(
    @Param("id") id: string,
    @Body("taskIds") taskIds: string[],
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const result = await this.usersService.setTaskPermissions(id, taskIds);
    await this.audit.log({
      action: "AGENT_TASK_PERMISSION_UPDATE",
      userId: actor.userId,
      entityType: "User",
      entityId: id,
      metadata: { taskIds },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return result;
  }

  @Put(":id/partner-restrictions")
  async setPartnerRestrictions(@Param("id") id: string, @Body("partnerIds") partnerIds: string[]) {
    return this.usersService.setPartnerRestrictions(id, partnerIds);
  }

  @Put(":id/category-restrictions")
  async setCategoryRestrictions(@Param("id") id: string, @Body("categoryIds") categoryIds: string[]) {
    return this.usersService.setCategoryRestrictions(id, categoryIds);
  }
}
