import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import {
  CreateUserDto,
  ListUsersQueryDto,
  SetUserRolesDto,
  SetUserStatusDto,
  UpdateUserDto,
} from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @RequirePermission('user.view')
  @Get()
  list(@PermissionScope() scope: RequestScope, @Query() q: ListUsersQueryDto) {
    return this.users.list(scope, q);
  }

  @RequirePermission('user.view')
  @Get(':id')
  get(@PermissionScope() scope: RequestScope, @Param('id') id: string) {
    return this.users.get(scope, id);
  }

  @RequirePermission('user.create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Body() dto: CreateUserDto,
    @Req() req: Request,
  ) {
    return this.users.create(user, scope, dto, { ip: req.ip });
  }

  @RequirePermission('user.edit')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @Req() req: Request,
  ) {
    return this.users.update(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('user.deactivate')
  @Patch(':id/status')
  setStatus(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: SetUserStatusDto,
    @Req() req: Request,
  ) {
    return this.users.setStatus(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('user.assign_roles')
  @Put(':id/roles')
  setRoles(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: SetUserRolesDto,
    @Req() req: Request,
  ) {
    return this.users.setRoles(user, scope, id, dto, { ip: req.ip });
  }
}
