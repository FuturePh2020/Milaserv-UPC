import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import {
  DashboardQueryDto,
  IngestMetricsDto,
  ListMetricsQueryDto,
  UpsertTargetDto,
} from './performance.dto';
import { PerformanceService } from './performance.service';

@Controller('performance')
export class PerformanceController {
  constructor(private readonly performance: PerformanceService) {}

  @RequirePermission('performance.view')
  @Get('metric-defs')
  metricDefs() {
    return this.performance.metricDefs();
  }

  /** Integration Layer slot (spec D1): the Yeastar connector lands here. */
  @RequirePermission('performance.ingest')
  @Post('metrics/ingest')
  @HttpCode(200)
  ingest(@CurrentUser() user: AuthUser, @Body() dto: IngestMetricsDto, @Req() req: Request) {
    return this.performance.ingest(user, dto, { ip: req.ip });
  }

  @RequirePermission('performance.view')
  @Get('metrics')
  metrics(@PermissionScope() scope: RequestScope, @Query() q: ListMetricsQueryDto) {
    return this.performance.metrics(scope, q);
  }

  @RequirePermission('performance.view')
  @Get('dashboard')
  dashboard(@PermissionScope() scope: RequestScope, @Query() q: DashboardQueryDto) {
    return this.performance.dashboard(scope, q);
  }

  @RequirePermission('performance.view')
  @Get('targets')
  targets(@PermissionScope() scope: RequestScope, @Query('teamId') teamId?: string) {
    return this.performance.listTargets(scope, teamId);
  }

  @RequirePermission('performance.manage')
  @Post('targets')
  upsertTarget(@CurrentUser() user: AuthUser, @Body() dto: UpsertTargetDto, @Req() req: Request) {
    return this.performance.upsertTarget(user, dto, { ip: req.ip });
  }

  @RequirePermission('performance.manage')
  @Delete('targets/:id')
  @HttpCode(204)
  deleteTarget(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.performance.deleteTarget(user, id, { ip: req.ip });
  }
}
