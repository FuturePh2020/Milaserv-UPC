import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { RequestMeta, RequestMeta as RequestMetaType } from "../common/decorators/request-meta.decorator";
import { CallOutcomesService, RecordCallOutcomeInput } from "./call-outcomes.service";

@ApiTags("call-outcomes")
@ApiBearerAuth()
@Controller("call-outcomes")
@UseGuards(RolesGuard)
@Roles(UserRole.AGENT)
export class CallOutcomesController {
  constructor(private readonly callOutcomesService: CallOutcomesService) {}

  @Post()
  record(@Body() body: RecordCallOutcomeInput, @CurrentUser() actor: AuthenticatedUser, @RequestMeta() meta: RequestMetaType) {
    return this.callOutcomesService.record(body, actor.userId, meta);
  }
}
