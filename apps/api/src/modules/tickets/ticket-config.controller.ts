import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { TicketConfigService } from './ticket-config.service';

class CreateCategoryDto {
  @IsString()
  typeKey: string;

  @IsString()
  @Matches(/^[A-Z0-9_]{2,60}$/)
  key: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameAr: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn: string;
}

class UpdateCatalogItemDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameAr?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nameEn?: string;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsInt()
  order?: number;
}

class UpdateSlaPolicyDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  firstResponseMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  resolutionMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  warningThresholdPct?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

@Controller('ticket-config')
export class TicketConfigController {
  constructor(private readonly config: TicketConfigService) {}

  /** Full catalog payload — drives the create form and config screens. */
  @RequirePermission('ticket.view')
  @Get()
  catalogs() {
    return this.config.catalogs();
  }

  @RequirePermission('ticket.manage_config')
  @Post('categories')
  createCategory(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCategoryDto,
    @Req() req: Request,
  ) {
    return this.config.createCategory(user, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.manage_config')
  @Patch('categories/:id')
  updateCategory(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
    @Req() req: Request,
  ) {
    return this.config.updateCategory(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.manage_config')
  @Patch('update-types/:id')
  updateUpdateType(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCatalogItemDto,
    @Req() req: Request,
  ) {
    return this.config.updateUpdateType(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('ticket.manage_config')
  @Patch('sla-policies/:id')
  updateSlaPolicy(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateSlaPolicyDto,
    @Req() req: Request,
  ) {
    return this.config.updateSlaPolicy(user, id, dto, { ip: req.ip });
  }
}
