import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../../core/auth/public.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { OnlineService } from '../online/online.service';
import { IngestOrdersDto } from '../online/online.dto';
import { ConnectorsService } from './connectors.service';
import { YeastarEventsDto } from './connectors.dto';

/**
 * §21 machine endpoints (integrations spec J1/J2/J7): no user session —
 * authenticated by the per-connector X-Integration-Token shared secret.
 */
@Controller('integrations')
export class ConnectorsController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly online: OnlineService,
  ) {}

  /** Yeastar P570 pushes call events → §12 metric values (J1). */
  @Public()
  @Post('yeastar/events')
  @HttpCode(200)
  async yeastarEvents(
    @Headers('x-integration-token') token: string | undefined,
    @Body() dto: YeastarEventsDto,
    @Req() req: Request,
  ) {
    await this.connectors.assertToken('yeastar', token);
    return this.connectors.ingestYeastarEvents(dto, { ip: req.ip });
  }

  /** Ordering system pushes orders → §13 ingest, unchanged semantics (J2). */
  @Public()
  @Post('ordering/events')
  @HttpCode(200)
  async orderingEvents(
    @Headers('x-integration-token') token: string | undefined,
    @Body() dto: IngestOrdersDto,
    @Req() req: Request,
  ) {
    await this.connectors.assertToken('ordering', token);
    return this.online.ingest({ userId: null, email: 'connector:ordering' }, dto, { ip: req.ip });
  }

  /** Connector cards for the admin Integration Monitor. */
  @RequirePermission('integration.monitor')
  @Get('connectors')
  list() {
    return this.connectors.connectors();
  }
}
