import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../permissions/require-permission.decorator';
import { BranchInventoryService } from './branch-inventory.service';
import { InventorySyncQueueService } from './queue/inventory-sync.queue';
import { SyncBranchInventoryDto } from './inventory.dto';

/** Phase 6 §11-§14 — branch inventory view + manual sync trigger. */
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly inventory: BranchInventoryService,
    private readonly syncQueue: InventorySyncQueueService,
  ) {}

  @RequirePermission('inventory.view')
  @Get('branches/:branchId')
  getBranchInventory(@Param('branchId') branchId: string) {
    return this.inventory.getBranchInventory(branchId);
  }

  @RequirePermission('inventory.sync')
  @Post('branches/:branchId/sync')
  @HttpCode(202)
  enqueueSync(@Param('branchId') branchId: string, @Body() dto: SyncBranchInventoryDto) {
    return this.syncQueue.enqueueSync(branchId, dto.drugIds);
  }
}
