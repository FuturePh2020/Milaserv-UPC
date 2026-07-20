import { Body, Controller, Get, Headers, Post, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { Public } from "../common/decorators/public.decorator";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { VoipService } from "./voip.service";
import { VoipSettingsService } from "./voip-settings.service";
import { MockVoipProvider } from "./adapters/mock-voip.provider";

@ApiTags("voip")
@Controller("voip")
export class VoipController {
  constructor(
    private readonly voipService: VoipService,
    private readonly voipSettings: VoipSettingsService,
    private readonly mockProvider: MockVoipProvider,
  ) {}

  @Get("settings")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  getSettings() {
    return this.voipSettings.get();
  }

  @Post("settings")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  updateSettings(@Body() body: any, @CurrentUser() actor: AuthenticatedUser) {
    return this.voipSettings.update(body, actor.userId);
  }

  @Get("status-mappings")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  listMappings() {
    return this.voipSettings.listStatusMappings();
  }

  @Post("status-mappings")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  upsertMapping(@Body("providerStatus") providerStatus: string, @Body("internalStatus") internalStatus: string) {
    return this.voipSettings.upsertStatusMapping(providerStatus, internalStatus);
  }

  @Post("calls/initiate")
  @UseGuards(RolesGuard)
  @Roles(UserRole.AGENT)
  initiateCall(
    @Body("leadId") leadId: string | undefined,
    @Body("customerPhone") customerPhone: string,
    @Body("taskId") taskId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.voipService.initiateOutboundCall({ agentId: actor.userId, leadId, customerPhone, taskId });
  }

  @Get("calls/mine")
  @UseGuards(RolesGuard)
  @Roles(UserRole.AGENT)
  myCalls(@Query("from") from: string | undefined, @Query("to") to: string | undefined, @CurrentUser() actor: AuthenticatedUser) {
    return this.voipService.myCalls(actor.userId, { from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
  }

  @Get("call-records")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  listCallRecords(@Query() query: any) {
    return this.voipService.listCallRecords({
      ...query,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      page: query.page ? Number(query.page) : undefined,
      pageSize: query.pageSize ? Number(query.pageSize) : undefined,
    });
  }

  @Get("metrics")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  metrics(@Query("agentId") agentId: string | undefined, @Query("from") from: string | undefined, @Query("to") to: string | undefined) {
    return this.voipService.metrics({ agentId, from: from ? new Date(from) : undefined, to: to ? new Date(to) : undefined });
  }

  @Public()
  @Post("webhook")
  handleWebhook(@Body() body: any, @Headers("x-webhook-signature") signature: string | undefined) {
    return this.voipService.handleWebhook(body, signature);
  }

  /** Dev/demo-only helper to progress a mock call without a real provider. */
  @Post("mock/advance")
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN)
  advanceMock(@Body("externalCallId") externalCallId: string, @Body("status") status: string) {
    return this.mockProvider.advance(externalCallId, status);
  }
}
