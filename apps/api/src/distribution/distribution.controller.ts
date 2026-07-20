import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { RequestMeta, RequestMeta as RequestMetaType } from "../common/decorators/request-meta.decorator";
import { DistributionService } from "./distribution.service";

@ApiTags("distribution")
@ApiBearerAuth()
@Controller("distribution")
@UseGuards(RolesGuard)
@Roles(UserRole.AGENT)
export class DistributionController {
  constructor(private readonly distributionService: DistributionService) {}

  @Post("generate-lead")
  generateLead(
    @Body("taskId") taskId: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    return this.distributionService.generateLead(actor.userId, taskId, meta);
  }
}
