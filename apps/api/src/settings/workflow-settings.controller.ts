import { Controller, Get, Query } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { SettingsService } from "./settings.service";

/**
 * Read-only lookups any authenticated role can fetch (agents need the
 * reschedule Morning/Evening windows, order-number format, configurable
 * reason lists, and auto-refresh config to render their own UI) — kept
 * separate from SettingsController, which is admin-only for writes.
 */
@ApiTags("workflow-settings")
@ApiBearerAuth()
@Controller("workflow-settings")
export class WorkflowSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get("crm-workflow")
  getCrmWorkflow() {
    return this.settings.getCrmWorkflowSettings();
  }

  @Get("auto-refresh")
  getAutoRefresh() {
    return this.settings.getAutoRefreshSettings();
  }

  @Get("reasons")
  listReasons(@Query("category") category?: string) {
    return this.settings.listConfigurableReasons(category);
  }
}
