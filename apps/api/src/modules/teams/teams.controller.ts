import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { PaginationQuery } from '../../core/pagination';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import { AddMemberDto, CreateTeamDto, UpdateTeamDto } from './teams.dto';
import { TeamsService } from './teams.service';

@Controller('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @RequirePermission('team.view')
  @Get()
  list(@PermissionScope() scope: RequestScope, @Query() q: PaginationQuery) {
    return this.teams.list(scope, q);
  }

  @RequirePermission('team.view')
  @Get(':id')
  get(@PermissionScope() scope: RequestScope, @Param('id') id: string) {
    return this.teams.get(scope, id);
  }

  @RequirePermission('team.manage')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Body() dto: CreateTeamDto,
    @Req() req: Request,
  ) {
    return this.teams.create(user, scope, dto, { ip: req.ip });
  }

  @RequirePermission('team.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @Req() req: Request,
  ) {
    return this.teams.update(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('team.manage')
  @Delete(':id')
  @HttpCode(204)
  archive(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.teams.archive(user, scope, id, { ip: req.ip });
  }

  @RequirePermission('team.manage_members')
  @Post(':id/members')
  addMember(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: AddMemberDto,
    @Req() req: Request,
  ) {
    return this.teams.addMember(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('team.manage_members')
  @Delete(':id/members/:userId')
  @HttpCode(204)
  removeMember(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Req() req: Request,
  ) {
    return this.teams.removeMember(user, scope, id, userId, { ip: req.ip });
  }
}
