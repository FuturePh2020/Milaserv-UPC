import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { RequestMeta, RequestMeta as RequestMetaType } from "../common/decorators/request-meta.decorator";
import { AuditService } from "../audit/audit.service";
import { PartnersService } from "./partners.service";

@ApiTags("partners")
@ApiBearerAuth()
@Controller("partners")
@UseGuards(RolesGuard)
export class PartnersController {
  constructor(
    private readonly partnersService: PartnersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  findAll(@Query("isActive") isActive?: string, @Query("categoryId") categoryId?: string) {
    return this.partnersService.findAll({
      isActive: isActive === undefined ? undefined : isActive === "true",
      categoryId,
    });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.partnersService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: any, @CurrentUser() actor: AuthenticatedUser, @RequestMeta() meta: RequestMetaType) {
    const partner = await this.partnersService.create(body);
    await this.audit.log({
      action: "PARTNER_CREATE",
      userId: actor.userId,
      entityType: "Partner",
      entityId: partner.id,
      metadata: { name: partner.name, code: partner.code },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return partner;
  }

  @Put(":id")
  @Roles(UserRole.ADMIN)
  async update(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const partner = await this.partnersService.update(id, body);
    await this.audit.log({
      action: "PARTNER_UPDATE",
      userId: actor.userId,
      entityType: "Partner",
      entityId: id,
      metadata: body,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return partner;
  }

  @Put(":id/active")
  @Roles(UserRole.ADMIN)
  async setActive(
    @Param("id") id: string,
    @Body("isActive") isActive: boolean,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const partner = await this.partnersService.setActive(id, isActive);
    await this.audit.log({
      action: "PARTNER_UPDATE",
      userId: actor.userId,
      entityType: "Partner",
      entityId: id,
      metadata: { isActive },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return partner;
  }

  @Post(":id/column-mappings")
  @Roles(UserRole.ADMIN)
  saveColumnMapping(
    @Param("id") id: string,
    @Body("name") name: string,
    @Body("mapping") mapping: Record<string, string>,
  ) {
    return this.partnersService.saveColumnMapping(id, name, mapping);
  }
}
