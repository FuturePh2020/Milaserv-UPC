import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { IngestOrdersDto, ListOnlineOrdersQueryDto, OnlineStatsQueryDto } from './online.dto';
import { OnlineService } from './online.service';

@Controller('online')
export class OnlineController {
  constructor(private readonly online: OnlineService) {}

  @RequirePermission('online.view')
  @Get('catalogs')
  catalogs() {
    return this.online.catalogs();
  }

  /** Integration Layer slot (spec F4): the Ordering connector lands here. */
  @RequirePermission('online.ingest')
  @Post('orders/ingest')
  @HttpCode(200)
  ingest(@CurrentUser() user: AuthUser, @Body() dto: IngestOrdersDto, @Req() req: Request) {
    return this.online.ingest(user, dto, { ip: req.ip });
  }

  @RequirePermission('online.view')
  @Get('orders')
  orders(@Query() q: ListOnlineOrdersQueryDto) {
    return this.online.list(q);
  }

  @RequirePermission('online.view')
  @Get('stats')
  stats(@Query() q: OnlineStatsQueryDto) {
    return this.online.stats(q);
  }
}
