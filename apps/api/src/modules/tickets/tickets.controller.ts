import { Body, Controller, Get, Header, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import {
  AddUpdateDto,
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  EscalateTicketDto,
  ListTicketsQueryDto,
  RedirectTicketDto,
  ReopenTicketDto,
  ResolveTicketDto,
} from './tickets.dto';
import { TicketsService } from './tickets.service';

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @RequirePermission('ticket.view')
  @Get()
  list(@PermissionScope() scope: RequestScope, @Query() q: ListTicketsQueryDto) {
    return this.tickets.list(scope, q);
  }

  @RequirePermission('ticket.export')
  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="tickets.csv"')
  export(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Query() q: ListTicketsQueryDto,
    @Req() req: Request,
  ) {
    return this.tickets.exportCsv(user, scope, q, { ip: req.ip });
  }

  @RequirePermission('ticket.view')
  @Get(':id')
  get(@PermissionScope() scope: RequestScope, @Param('id') id: string) {
    return this.tickets.get(scope, id);
  }

  @RequirePermission('ticket.create')
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Body() dto: CreateTicketDto,
    @Req() req: Request,
  ) {
    return this.tickets.create(user, scope, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.assign')
  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: AssignTicketDto,
    @Req() req: Request,
  ) {
    return this.tickets.assign(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.take_responsibility')
  @Post(':id/take')
  take(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.tickets.take(user, scope, id, { ip: req.ip });
  }

  @RequirePermission('ticket.redirect')
  @Post(':id/redirect')
  redirect(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: RedirectTicketDto,
    @Req() req: Request,
  ) {
    return this.tickets.redirect(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.update_add')
  @Post(':id/updates')
  addUpdate(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: AddUpdateDto,
    @Req() req: Request,
  ) {
    return this.tickets.addUpdate(user, scope, id, dto, { ip: req.ip });
  }

  // Guard note: transition-specific permissions are enforced from the seeded
  // matrix inside the service (spec §5); ticket.view gates entry here.
  @RequirePermission('ticket.view')
  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @Req() req: Request,
  ) {
    return this.tickets.changeStatus(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.escalate')
  @Post(':id/escalate')
  escalate(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: EscalateTicketDto,
    @Req() req: Request,
  ) {
    return this.tickets.escalate(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.resolve')
  @Post(':id/resolve')
  resolve(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: ResolveTicketDto,
    @Req() req: Request,
  ) {
    return this.tickets.resolve(user, scope, id, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.close')
  @Post(':id/close')
  close(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.tickets.close(user, scope, id, { ip: req.ip });
  }

  @RequirePermission('ticket.reopen')
  @Post(':id/reopen')
  reopen(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: ReopenTicketDto,
    @Req() req: Request,
  ) {
    return this.tickets.reopen(user, scope, id, dto, { ip: req.ip });
  }
}
