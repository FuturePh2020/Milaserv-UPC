import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { DeleteSettingOverrideQueryDto, ListSettingsQueryDto, PutSettingDto } from './settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @RequirePermission('setting.view')
  @Get()
  list(@Query() q: ListSettingsQueryDto) {
    return this.settings.list(q);
  }

  @RequirePermission('setting.manage')
  @Put(':key')
  put(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Body() dto: PutSettingDto,
    @Req() req: Request,
  ) {
    return this.settings.put(user, key, dto, { ip: req.ip });
  }

  @RequirePermission('setting.manage')
  @Delete(':key/override')
  @HttpCode(204)
  deleteOverride(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @Query() q: DeleteSettingOverrideQueryDto,
    @Req() req: Request,
  ) {
    return this.settings.deleteOverride(user, key, q.scopeLevel, q.scopeId, { ip: req.ip });
  }
}
