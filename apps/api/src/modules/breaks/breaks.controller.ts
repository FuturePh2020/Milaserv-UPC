import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import { HeartbeatDto, ListSessionsQueryDto } from './breaks.dto';
import { BreaksService } from './breaks.service';

@Controller('breaks')
export class BreaksController {
  constructor(private readonly breaks: BreaksService) {}

  // ── Own tracking (§11.1/§11.2) ─────────────────────────────────────

  @RequirePermission('break.track')
  @Post('session/start')
  startSession(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.breaks.startSession(user, { ip: req.ip });
  }

  @RequirePermission('break.track')
  @Post('session/end')
  @HttpCode(200)
  endSession(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.breaks.endSession(user, { ip: req.ip });
  }

  @RequirePermission('break.track')
  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@CurrentUser() user: AuthUser, @Body() dto: HeartbeatDto) {
    return this.breaks.heartbeat(user, dto);
  }

  @RequirePermission('break.track')
  @Post('break/start')
  @HttpCode(200)
  startBreak(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.breaks.startBreak(user, { ip: req.ip });
  }

  @RequirePermission('break.track')
  @Post('break/end')
  @HttpCode(200)
  endBreak(@CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.breaks.endBreak(user, { ip: req.ip });
  }

  @RequirePermission('break.track')
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.breaks.me(user);
  }

  // ── Team visibility (§11.3) ────────────────────────────────────────

  @RequirePermission('break.viewTeam')
  @Get('live')
  live(@PermissionScope() scope: RequestScope) {
    return this.breaks.live(scope);
  }

  @RequirePermission('break.viewTeam')
  @Get('sessions')
  sessions(@PermissionScope() scope: RequestScope, @Query() q: ListSessionsQueryDto) {
    return this.breaks.sessions(scope, q);
  }
}
