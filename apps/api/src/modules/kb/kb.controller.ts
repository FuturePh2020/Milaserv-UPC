import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { PermissionScope } from '../permissions/permission-scope.decorator';
import { RequirePermission } from '../permissions/require-permission.decorator';
import type { RequestScope } from '../permissions/scope';
import {
  AddLessonDto,
  AssignCourseDto,
  CreateContentDto,
  CreateCourseDto,
  LessonProgressDto,
  ListContentsQueryDto,
  UpdateContentDto,
  UpdateCourseDto,
} from './kb.dto';
import { KbContentService } from './kb-content.service';
import { CoursesService } from './courses.service';

@Controller('kb')
export class KbController {
  constructor(
    private readonly contents: KbContentService,
    private readonly courses: CoursesService,
  ) {}

  // ── Content library ────────────────────────────────────────────────

  @RequirePermission('kb.view')
  @Get('contents')
  listContents(@PermissionScope() scope: RequestScope, @Query() q: ListContentsQueryDto) {
    return this.contents.list(scope.context.permissions, q);
  }

  @RequirePermission('kb.view')
  @Get('contents/:id')
  getContent(@PermissionScope() scope: RequestScope, @Param('id') id: string) {
    return this.contents.get(scope.context.permissions, id);
  }

  @RequirePermission('kb.manage')
  @Post('contents')
  createContent(@CurrentUser() user: AuthUser, @Body() dto: CreateContentDto, @Req() req: Request) {
    return this.contents.create(user, dto, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Patch('contents/:id')
  updateContent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
    @Req() req: Request,
  ) {
    return this.contents.update(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Post('contents/:id/new-version')
  newVersion(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.contents.newVersion(user, id, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Post('contents/:id/publish')
  publishContent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.contents.publish(user, id, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Post('contents/:id/archive')
  @HttpCode(204)
  archiveContent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.contents.archive(user, id, { ip: req.ip });
  }

  // ── Courses ────────────────────────────────────────────────────────

  @RequirePermission('kb.view')
  @Get('courses')
  listCourses(@CurrentUser() user: AuthUser, @PermissionScope() scope: RequestScope) {
    return this.courses.list(user, scope.context.permissions);
  }

  @RequirePermission('kb.view')
  @Get('courses/:id')
  getCourse(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
  ) {
    return this.courses.get(user, scope.context.permissions, id);
  }

  @RequirePermission('kb.manage')
  @Post('courses')
  createCourse(@CurrentUser() user: AuthUser, @Body() dto: CreateCourseDto, @Req() req: Request) {
    return this.courses.create(user, dto, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Patch('courses/:id')
  updateCourse(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
    @Req() req: Request,
  ) {
    return this.courses.update(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Post('courses/:id/publish')
  publishCourse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.courses.publish(user, id, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Post('courses/:id/lessons')
  addLesson(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AddLessonDto,
    @Req() req: Request,
  ) {
    return this.courses.addLesson(user, id, dto, { ip: req.ip });
  }

  @RequirePermission('kb.manage')
  @Delete('lessons/:id')
  @HttpCode(204)
  removeLesson(@CurrentUser() user: AuthUser, @Param('id') id: string, @Req() req: Request) {
    return this.courses.removeLesson(user, id, { ip: req.ip });
  }

  // kb.view entry — the service enforces course-admin/kb.assign (spec B2).
  @RequirePermission('kb.view')
  @Post('courses/:id/assign')
  assignCourse(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: AssignCourseDto,
    @Req() req: Request,
  ) {
    return this.courses.assign(user, scope.context.permissions, id, dto, { ip: req.ip });
  }

  @RequirePermission('kb.view')
  @Get('courses/:id/progress')
  progressOverview(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
  ) {
    return this.courses.progressOverview(user, scope.context.permissions, id);
  }

  @RequirePermission('kb.view')
  @Post('lessons/:id/progress')
  recordProgress(
    @CurrentUser() user: AuthUser,
    @PermissionScope() scope: RequestScope,
    @Param('id') id: string,
    @Body() dto: LessonProgressDto,
    @Req() req: Request,
  ) {
    return this.courses.recordProgress(user, scope.context.permissions, id, dto, { ip: req.ip });
  }
}
