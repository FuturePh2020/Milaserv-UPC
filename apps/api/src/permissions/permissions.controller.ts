import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole, Permission } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { AuditService } from "../audit/audit.service";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { PermissionsService } from "./permissions.service";

@ApiTags("permissions")
@ApiBearerAuth()
@Controller("users/:userId/permissions")
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class PermissionsController {
  constructor(
    private readonly permissionsService: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Param("userId") userId: string) {
    return this.permissionsService.listForUser(userId);
  }

  @Put()
  async set(
    @Param("userId") userId: string,
    @Body("permissions") permissions: Permission[],
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const result = await this.permissionsService.setForUser(userId, permissions);
    await this.audit.log({
      action: "USER_UPDATE",
      userId: actor.userId,
      entityType: "User",
      entityId: userId,
      metadata: { permissionsGranted: permissions },
    });
    return result;
  }
}
