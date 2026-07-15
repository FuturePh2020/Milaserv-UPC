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
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { CreateBranchDto, ListBranchesQueryDto, UpdateBranchDto } from './branches.dto';
import { BranchesService } from './branches.service';

@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @RequirePermission('branch.view')
  @Get()
  list(@Query() q: ListBranchesQueryDto) {
    return this.branches.list(q);
  }

  @RequirePermission('branch.view')
  @Get(':id')
  get(@Param('id') id: string) {
    return this.branches.get(id);
  }

  @RequirePermission('branch.manage')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBranchDto, @Req() req: Request) {
    return this.branches.create(user, dto, { ip: req.ip });
  }

  @RequirePermission('branch.manage')
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: Request,
  ) {
    return this.branches.update(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('branch.manage')
  @Delete(':id')
  @HttpCode(204)
  archive(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.branches.archive(user, id, { ip: req.ip });
  }
}
