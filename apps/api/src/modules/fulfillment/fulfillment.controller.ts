import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { CreateFulfillmentRequestDto, CreateSearchLocationDto } from './fulfillment.dto';
import { FulfillmentRequestService } from './fulfillment-request.service';
import { FulfillmentPlanGeneratorService } from './fulfillment-plan-generator.service';
import { FulfillmentPlanSelectionService } from './fulfillment-plan-selection.service';

/**
 * Phase 6 §16-§27 — search-location resolution, fulfillment requests,
 * ranked plan generation/listing, and the one authorized "confirm a
 * plan" action. No checkout, payment, or insurance endpoint exists here
 * — those stay out of scope per the Phase 6 brief.
 */
@Controller('fulfillment')
export class FulfillmentController {
  constructor(
    private readonly requests: FulfillmentRequestService,
    private readonly generator: FulfillmentPlanGeneratorService,
    private readonly selection: FulfillmentPlanSelectionService,
  ) {}

  @RequirePermission('fulfillment.request')
  @Post('search-locations')
  createSearchLocation(@CurrentUser() user: AuthUser, @Body() dto: CreateSearchLocationDto) {
    return this.requests.createSearchLocation({ ...dto, createdById: user.userId });
  }

  @RequirePermission('fulfillment.request')
  @Post('requests')
  createRequest(@CurrentUser() user: AuthUser, @Body() dto: CreateFulfillmentRequestDto) {
    return this.requests.createRequest({ ...dto, initiatedById: user.userId });
  }

  @RequirePermission('fulfillment.view')
  @Get('requests/:id')
  getRequest(@Param('id') id: string) {
    return this.requests.getRequest(id);
  }

  @RequirePermission('fulfillment.request')
  @Post('requests/:id/generate-plans')
  generatePlans(@Param('id') id: string) {
    return this.generator.generate(id);
  }

  @RequirePermission('fulfillment.view')
  @Get('requests/:id/plans')
  listPlans(@Param('id') id: string) {
    return this.requests.listPlans(id);
  }

  @RequirePermission('fulfillment.select_plan')
  @Post('requests/:id/plans/:planId/select')
  selectPlan(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('planId') planId: string,
    @Req() req: Request,
  ) {
    return this.selection.selectPlan(user, id, planId, { ip: req.ip });
  }
}
