import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import {
  ListLeadsQueryDto,
  ListOrdersQueryDto,
  LogCallDto,
  UpdateOrderStatusDto,
  UploadLeadsDto,
} from './crm.dto';
import { CrmService } from './crm.service';

@Controller('crm')
export class CrmController {
  constructor(private readonly crm: CrmService) {}

  @RequirePermission('crm.view')
  @Get('catalogs')
  catalogs() {
    return this.crm.catalogs();
  }

  // ── Leads upload (§14.1) ───────────────────────────────────────────

  @RequirePermission('crm.upload')
  @Post('leads/preview')
  @HttpCode(200)
  preview(@Body() dto: UploadLeadsDto) {
    return this.crm.preview(dto);
  }

  @RequirePermission('crm.upload')
  @Post('leads/import')
  import(@CurrentUser() user: AuthUser, @Body() dto: UploadLeadsDto, @Req() req: Request) {
    return this.crm.import(user, dto, { ip: req.ip });
  }

  // ── Working leads ──────────────────────────────────────────────────

  @RequirePermission('crm.view')
  @Get('leads')
  leads(@PermissionScope() scope: RequestScope, @Query() q: ListLeadsQueryDto) {
    return this.crm.listLeads(scope, q);
  }

  @RequirePermission('crm.work')
  @Post('leads/next')
  @HttpCode(200)
  next(@CurrentUser() user: AuthUser) {
    return this.crm.nextLead(user);
  }

  @RequirePermission('crm.work')
  @Post('leads/:id/call')
  logCall(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: LogCallDto,
    @Req() req: Request,
  ) {
    return this.crm.logCall(user, scope, id, dto, { ip: req.ip });
  }

  // ── Orders (§14.4) ─────────────────────────────────────────────────

  @RequirePermission('crm.view')
  @Get('orders')
  orders(@PermissionScope() scope: RequestScope, @Query() q: ListOrdersQueryDto) {
    return this.crm.listOrders(scope, q);
  }

  @RequirePermission('crm.work')
  @Patch('orders/:id/status')
  orderStatus(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
    @Req() req: Request,
  ) {
    return this.crm.updateOrderStatus(user, scope, id, dto, { ip: req.ip });
  }
}
