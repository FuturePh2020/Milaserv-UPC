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
import { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';
import { DepartmentsService } from './departments.service';

@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @RequirePermission('department.view')
  @Get()
  list(@PermissionScope() scope: RequestScope, @Query() q: PaginationQuery) {
    return this.departments.list(scope, q);
  }

  @RequirePermission('department.view')
  @Get(':id')
  get(@PermissionScope() scope: RequestScope, @Param('id') id: string) {
    return this.departments.get(scope, id);
  }

  @RequirePermission('department.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDepartmentDto, @Req() req: Request) {
    return this.departments.create(user, dto, { ip: req.ip });
  }

  @RequirePermission('department.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @Req() req: Request,
  ) {
    return this.departments.update(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('department.manage')
  @Delete(':id')
  @HttpCode(204)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.departments.archive(user, id, { ip: req.ip });
  }
}
