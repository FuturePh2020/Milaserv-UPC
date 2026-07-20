import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { CreateRoleDto, UpdateRoleDto } from './roles.dto';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @RequirePermission('role.view')
  @Get('catalog')
  catalog() {
    return this.roles.catalog();
  }

  @RequirePermission('role.view')
  @Get()
  list() {
    return this.roles.list();
  }

  @RequirePermission('role.view')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.roles.get(id);
  }

  @RequirePermission('role.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateRoleDto, @Req() req: Request) {
    return this.roles.create(user, dto, { ip: req.ip });
  }

  @RequirePermission('role.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: Request,
  ) {
    return this.roles.update(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('role.manage')
  @Delete(':id')
  @HttpCode(204)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.roles.archive(user, id, { ip: req.ip });
  }
}
