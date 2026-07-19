import { Body, Controller, Get, HttpCode, Param, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { DicAliasService } from './dic-alias.service';
import { DicAlternativeService } from './dic-alternative.service';
import {
  CreateAliasDto,
  CreateAlternativeLinkDto,
  DecideAliasDto,
  DecideAlternativeLinkDto,
  UpdateAliasDto,
  UpdateAlternativeLinkDto,
} from './dic.dto';

/**
 * CR-002 Phase 4 Step 4 — alias and alternative-link propose/approve/
 * reject workflows (design doc §6/§10/§17). Proposing is dic.edit
 * (routine drug-entry work); approving is a distinct, narrower
 * permission (dic.approve_alias / dic.approve_alternative) — "do not
 * allow all users to approve aliases or alternatives."
 */
@Controller('dic')
export class DicRelationsController {
  constructor(
    private readonly aliases: DicAliasService,
    private readonly alternatives: DicAlternativeService,
  ) {}

  // ── Aliases ──────────────────────────────────────────────────────────

  @RequirePermission('dic.view')
  @Get('drugs/:id/aliases')
  listAliases(@Param('id') id: string) {
    return this.aliases.listForDrug(id);
  }

  @RequirePermission('dic.edit')
  @Post('drugs/:id/aliases')
  proposeAlias(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateAliasDto,
    @Req() req: Request,
  ) {
    return this.aliases.propose(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.approve_alias')
  @Get('aliases/pending')
  pendingAliases() {
    return this.aliases.listPending();
  }

  @RequirePermission('dic.edit')
  @Patch('aliases/:aliasId')
  updateAlias(
    @CurrentUser() user: AuthUser,
    @Param('aliasId') aliasId: string,
    @Body() dto: UpdateAliasDto,
    @Req() req: Request,
  ) {
    return this.aliases.update(user, aliasId, dto, { ip: req.ip });
  }

  @RequirePermission('dic.approve_alias')
  @Post('aliases/:aliasId/decide')
  @HttpCode(200)
  decideAlias(
    @CurrentUser() user: AuthUser,
    @Param('aliasId') aliasId: string,
    @Body() dto: DecideAliasDto,
    @Req() req: Request,
  ) {
    return this.aliases.decide(user, aliasId, dto, { ip: req.ip });
  }

  // ── Alternative links ───────────────────────────────────────────────

  @RequirePermission('dic.view')
  @Get('drugs/:id/alternative-links')
  listAlternativeLinks(@Param('id') id: string) {
    return this.alternatives.listForDrug(id);
  }

  @RequirePermission('dic.edit')
  @Post('drugs/:id/alternative-links')
  proposeAlternativeLink(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateAlternativeLinkDto,
    @Req() req: Request,
  ) {
    return this.alternatives.propose(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('dic.approve_alternative')
  @Get('alternative-links/pending')
  pendingAlternativeLinks() {
    return this.alternatives.listPending();
  }

  @RequirePermission('dic.edit')
  @Patch('alternative-links/:linkId')
  updateAlternativeLink(
    @CurrentUser() user: AuthUser,
    @Param('linkId') linkId: string,
    @Body() dto: UpdateAlternativeLinkDto,
    @Req() req: Request,
  ) {
    return this.alternatives.update(user, linkId, dto, { ip: req.ip });
  }

  @RequirePermission('dic.approve_alternative')
  @Post('alternative-links/:linkId/decide')
  @HttpCode(200)
  decideAlternativeLink(
    @CurrentUser() user: AuthUser,
    @Param('linkId') linkId: string,
    @Body() dto: DecideAlternativeLinkDto,
    @Req() req: Request,
  ) {
    return this.alternatives.decide(user, linkId, dto, { ip: req.ip });
  }
}
