import { Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IsIn, IsOptional, IsString } from 'class-validator';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { PaginationQuery } from '../../core/pagination';
import { IntegrationsService } from './integrations.service';

export class ListOperationsQueryDto extends PaginationQuery {
  @IsOptional()
  @IsIn(['PENDING', 'SUCCEEDED', 'FAILED', 'DEAD'])
  status?: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'DEAD';

  @IsOptional()
  @IsString()
  integrationKey?: string;
}

/** Integration Monitor (§13). */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @RequirePermission('integration.monitor')
  @Get('monitor')
  monitor() {
    return this.integrations.monitor();
  }

  @RequirePermission('integration.monitor')
  @Get('operations')
  operations(@Query() q: ListOperationsQueryDto) {
    return this.integrations.listOperations(q);
  }

  @RequirePermission('integration.monitor')
  @Post('operations/:id/retry')
  @HttpCode(200)
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.integrations.retry(user, id, { ip: req.ip });
  }
}
