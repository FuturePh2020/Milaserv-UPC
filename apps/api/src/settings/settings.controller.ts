import { Body, Controller, Get, Put, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { AuditService } from "../audit/audit.service";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { SettingsService } from "./settings.service";

@ApiTags("settings")
@ApiBearerAuth()
@Controller("settings")
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get("security")
  getSecurity() {
    return this.settings.getSecuritySettings();
  }

  @Put("security")
  async updateSecurity(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.settings.updateSecuritySettings(body);
    await this.audit.log({ action: "DISTRIBUTION_RULE_UPDATE", userId: user.userId, entityType: "SecuritySettings", metadata: body });
    return result;
  }

  @Get("distribution")
  getDistribution() {
    return this.settings.getDistributionSettings();
  }

  @Put("distribution")
  async updateDistribution(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.settings.updateDistributionSettings(body);
    await this.audit.log({ action: "DISTRIBUTION_RULE_UPDATE", userId: user.userId, entityType: "DistributionSettings", metadata: body });
    return result;
  }

  @Get("inactivity")
  getInactivity() {
    return this.settings.getInactivitySettings();
  }

  @Put("inactivity")
  async updateInactivity(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.settings.updateInactivitySettings(body);
    await this.audit.log({ action: "DISTRIBUTION_RULE_UPDATE", userId: user.userId, entityType: "InactivitySettings", metadata: body });
    return result;
  }

  @Get("break-thresholds")
  getBreakThresholds() {
    return this.settings.getBreakThresholdSettings();
  }

  @Put("break-thresholds")
  async updateBreakThresholds(@Body() body: any, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.settings.updateBreakThresholdSettings(body);
    await this.audit.log({ action: "DISTRIBUTION_RULE_UPDATE", userId: user.userId, entityType: "BreakThresholdSettings", metadata: body });
    return result;
  }
}
