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
import {
  CreateBranchDto,
  ImportBranchesDto,
  ListBranchesQueryDto,
  NearestQueryDto,
  UpdateBranchDto,
} from './branches.dto';
import { BranchesService } from './branches.service';
import { BranchImportService } from './branch-import.service';

@Controller('branches')
export class BranchesController {
  constructor(
    private readonly branches: BranchesService,
    private readonly importer: BranchImportService,
  ) {}

  @RequirePermission('branch.view')
  @Get()
  list(@Query() q: ListBranchesQueryDto) {
    return this.branches.list(q);
  }

  @RequirePermission('branch.view')
  @Get('types')
  types() {
    return this.branches.types();
  }

  /** §16.3 Locator & Delivery Estimator. */
  @RequirePermission('branch.view')
  @Get('nearest')
  nearest(@Query() q: NearestQueryDto) {
    return this.branches.nearest(q);
  }

  /** §16.1 master-data import (United Locations format, spec G2/G3). */
  @RequirePermission('branch.manage')
  @Post('import/preview')
  @HttpCode(200)
  importPreview(@Body() dto: ImportBranchesDto) {
    return this.importer.preview(dto);
  }

  @RequirePermission('branch.manage')
  @Post('import')
  import(@CurrentUser() user: AuthUser, @Body() dto: ImportBranchesDto, @Req() req: Request) {
    return this.importer.import(user, dto, { ip: req.ip });
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
