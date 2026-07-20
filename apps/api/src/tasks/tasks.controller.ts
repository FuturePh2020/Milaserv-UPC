import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { UserRole } from "@lcrm/shared";
import { Roles } from "../common/decorators/roles.decorator";
import { RolesGuard } from "../common/guards/roles.guard";
import { CurrentUser, AuthenticatedUser } from "../common/decorators/current-user.decorator";
import { RequestMeta, RequestMeta as RequestMetaType } from "../common/decorators/request-meta.decorator";
import { AuditService } from "../audit/audit.service";
import { TasksService } from "./tasks.service";

@ApiTags("tasks")
@ApiBearerAuth()
@Controller("tasks")
@UseGuards(RolesGuard)
export class TasksController {
  constructor(
    private readonly tasksService: TasksService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  findAll(@Query("isActive") isActive?: string) {
    return this.tasksService.findAll({ isActive: isActive === undefined ? undefined : isActive === "true" });
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.tasksService.findOne(id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  async create(@Body() body: any, @CurrentUser() actor: AuthenticatedUser, @RequestMeta() meta: RequestMetaType) {
    const task = await this.tasksService.create(body);
    await this.audit.log({
      action: "TASK_CREATE",
      userId: actor.userId,
      entityType: "Task",
      entityId: task.id,
      metadata: { name: task.name, code: task.code },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return task;
  }

  @Put(":id")
  @Roles(UserRole.ADMIN)
  async update(
    @Param("id") id: string,
    @Body() body: any,
    @CurrentUser() actor: AuthenticatedUser,
    @RequestMeta() meta: RequestMetaType,
  ) {
    const task = await this.tasksService.update(id, body);
    await this.audit.log({
      action: "TASK_UPDATE",
      userId: actor.userId,
      entityType: "Task",
      entityId: id,
      metadata: body,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return task;
  }
}
