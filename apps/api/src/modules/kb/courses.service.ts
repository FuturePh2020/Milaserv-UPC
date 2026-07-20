import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Course, Prisma } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TimelineService } from '../timeline/timeline.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../auth/current-user.decorator';
import type { EffectivePermissions } from '../permissions/scope';
import type {
  AddLessonDto,
  AssignCourseDto,
  CreateCourseDto,
  LessonProgressDto,
  UpdateCourseDto,
} from './kb.dto';

interface Meta {
  ip?: string;
}

const ADMIN_SELECT = { select: { id: true, nameAr: true, nameEn: true, email: true } };

type Perms = EffectivePermissions['permissions'];

/**
 * Courses & progress (blueprint §10.2/§10.3). Visibility (spec B2): assigned
 * directly / via a team / Course Admin / kb.manage. Progress % is derived
 * from completed lessons; per-user overview includes last activity (§10.2).
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly timeline: TimelineService,
    private readonly notifications: NotificationsService,
  ) {}

  private canManage(perms: Perms): boolean {
    return 'kb.manage' in perms;
  }

  private async visibleWhere(actor: AuthUser, perms: Perms): Promise<Prisma.CourseWhereInput> {
    if (this.canManage(perms)) return {};
    const memberships = await this.prisma.teamMember.findMany({
      where: { userId: actor.userId },
      select: { teamId: true },
    });
    return {
      status: 'PUBLISHED',
      OR: [
        { courseAdminId: actor.userId },
        { assignments: { some: { userId: actor.userId } } },
        { assignments: { some: { teamId: { in: memberships.map((m) => m.teamId) } } } },
      ],
    };
  }

  private async assertVisible(actor: AuthUser, perms: Perms, id: string): Promise<Course> {
    const course = await this.prisma.course.findFirst({
      where: { AND: [{ id, deletedAt: null }, await this.visibleWhere(actor, perms)] },
    });
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  private canAdminister(actor: AuthUser, perms: Perms, course: Course): boolean {
    return this.canManage(perms) || 'kb.assign' in perms || course.courseAdminId === actor.userId;
  }

  /** §10.3 indicators for one user on one course. */
  private progressSummary(
    lessonIds: string[],
    rows: {
      lessonId: string;
      completedAt: Date | null;
      watchTimeSeconds: number;
      updatedAt: Date;
    }[],
  ) {
    const total = lessonIds.length;
    const completed = rows.filter((r) => r.completedAt).length;
    const started = rows.length > 0;
    return {
      status:
        total > 0 && completed === total ? 'COMPLETED' : started ? 'IN_PROGRESS' : 'NOT_STARTED',
      progressPct: total === 0 ? 0 : Math.round((completed / total) * 100),
      watchTimeSeconds: rows.reduce((sum, r) => sum + r.watchTimeSeconds, 0),
      lastActivityAt: rows.length
        ? new Date(Math.max(...rows.map((r) => r.updatedAt.getTime()))).toISOString()
        : null,
    };
  }

  async list(actor: AuthUser, perms: Perms) {
    const courses = await this.prisma.course.findMany({
      where: { AND: [{ deletedAt: null }, await this.visibleWhere(actor, perms)] },
      include: {
        courseAdmin: ADMIN_SELECT,
        lessons: { select: { id: true } },
        _count: { select: { assignments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const myProgress = await this.prisma.lessonProgress.findMany({
      where: { userId: actor.userId, lesson: { courseId: { in: courses.map((c) => c.id) } } },
      include: { lesson: { select: { courseId: true } } },
    });
    return courses.map((c) => ({
      ...c,
      lessons: undefined,
      lessonCount: c.lessons.length,
      myProgress: this.progressSummary(
        c.lessons.map((l) => l.id),
        myProgress.filter((p) => p.lesson.courseId === c.id),
      ),
    }));
  }

  async get(actor: AuthUser, perms: Perms, id: string) {
    const course = await this.assertVisible(actor, perms, id);
    const [lessons, assignments] = await Promise.all([
      this.prisma.courseLesson.findMany({
        where: { courseId: id },
        include: {
          content: {
            select: { id: true, kind: true, titleAr: true, titleEn: true, videoUrl: true },
          },
          progress: { where: { userId: actor.userId } },
        },
        orderBy: { order: 'asc' },
      }),
      this.prisma.courseAssignment.findMany({
        where: { courseId: id },
        include: {
          team: { select: { id: true, nameAr: true, nameEn: true } },
          user: { select: { id: true, nameAr: true, nameEn: true, email: true } },
        },
      }),
    ]);
    const progressRows = lessons.flatMap((l) => l.progress);
    const admin = await this.prisma.user.findUnique({
      where: { id: course.courseAdminId },
      select: ADMIN_SELECT.select,
    });
    return {
      ...course,
      courseAdmin: admin,
      lessons: lessons.map((l) => ({
        ...l,
        progress: undefined,
        myProgress: l.progress[0] ?? null,
      })),
      assignments: this.canAdminister(actor, perms, course) ? assignments : undefined,
      myProgress: this.progressSummary(
        lessons.map((l) => l.id),
        progressRows,
      ),
    };
  }

  async create(actor: AuthUser, dto: CreateCourseDto, meta: Meta) {
    if (dto.courseAdminId) {
      const admin = await this.prisma.user.findFirst({
        where: { id: dto.courseAdminId, deletedAt: null },
      });
      if (!admin) throw new NotFoundException('Course admin user not found');
    }
    const course = await this.prisma.course.create({
      data: {
        titleAr: dto.titleAr,
        titleEn: dto.titleEn,
        descriptionAr: dto.descriptionAr,
        descriptionEn: dto.descriptionEn,
        courseAdminId: dto.courseAdminId ?? actor.userId,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined,
      },
      include: { courseAdmin: ADMIN_SELECT },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.course_create',
      entityType: 'course',
      entityId: course.id,
      after: { titleEn: dto.titleEn },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'course',
      entityId: course.id,
      eventType: 'created',
      actorId: actor.userId,
    });
    return course;
  }

  async update(actor: AuthUser, id: string, dto: UpdateCourseDto, meta: Meta) {
    const before = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw new NotFoundException('Course not found');
    const course = await this.prisma.course.update({
      where: { id },
      data: { ...dto, dueAt: dto.dueAt ? new Date(dto.dueAt) : undefined },
      include: { courseAdmin: ADMIN_SELECT },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.course_update',
      entityType: 'course',
      entityId: id,
      before: { titleEn: before.titleEn, courseAdminId: before.courseAdminId },
      after: dto,
      ...meta,
    });
    return course;
  }

  async publish(actor: AuthUser, id: string, meta: Meta) {
    const course = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');
    const lessonCount = await this.prisma.courseLesson.count({ where: { courseId: id } });
    if (lessonCount === 0) throw new BadRequestException('Add at least one lesson first');

    await this.prisma.course.update({ where: { id }, data: { status: 'PUBLISHED' } });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.course_publish',
      entityType: 'course',
      entityId: id,
      ...meta,
    });
    await this.timeline.record({
      entityType: 'course',
      entityId: id,
      eventType: 'published',
      actorId: actor.userId,
    });
    return this.prisma.course.findUniqueOrThrow({
      where: { id },
      include: { courseAdmin: ADMIN_SELECT },
    });
  }

  async addLesson(actor: AuthUser, courseId: string, dto: AddLessonDto, meta: Meta) {
    const course = await this.prisma.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');
    if (dto.contentId) {
      const content = await this.prisma.kbContent.findFirst({
        where: { id: dto.contentId, deletedAt: null },
      });
      if (!content) throw new NotFoundException('Linked content not found');
    }
    const maxOrder = await this.prisma.courseLesson.aggregate({
      where: { courseId },
      _max: { order: true },
    });
    const lesson = await this.prisma.courseLesson.create({
      data: {
        courseId,
        order: (maxOrder._max.order ?? 0) + 1,
        titleAr: dto.titleAr,
        titleEn: dto.titleEn,
        contentId: dto.contentId,
        videoUrl: dto.videoUrl,
        durationSeconds: dto.durationSeconds,
      },
    });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.lesson_add',
      entityType: 'course',
      entityId: courseId,
      after: { lessonId: lesson.id, titleEn: dto.titleEn },
      ...meta,
    });
    return lesson;
  }

  async removeLesson(actor: AuthUser, lessonId: string, meta: Meta) {
    const lesson = await this.prisma.courseLesson.findUnique({ where: { id: lessonId } });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.prisma.courseLesson.delete({ where: { id: lessonId } });
    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.lesson_remove',
      entityType: 'course',
      entityId: lesson.courseId,
      before: { lessonId, titleEn: lesson.titleEn },
      ...meta,
    });
  }

  /** §10.2: assign to teams and/or users; assignees notified. */
  async assign(actor: AuthUser, perms: Perms, id: string, dto: AssignCourseDto, meta: Meta) {
    const course = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');
    if (!this.canAdminister(actor, perms, course)) {
      throw new ForbiddenException('Only kb.assign holders or the course admin can assign');
    }
    const teamIds = dto.teamIds ?? [];
    const userIds = dto.userIds ?? [];
    if (teamIds.length === 0 && userIds.length === 0) {
      throw new BadRequestException('Provide teamIds and/or userIds');
    }

    const existing = await this.prisma.courseAssignment.findMany({ where: { courseId: id } });
    const newTeams = teamIds.filter((t) => !existing.some((a) => a.teamId === t));
    const newUsers = userIds.filter((u) => !existing.some((a) => a.userId === u));
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : undefined;

    await this.prisma.courseAssignment.createMany({
      data: [
        ...newTeams.map((teamId) => ({ courseId: id, teamId, assignedById: actor.userId, dueAt })),
        ...newUsers.map((userId) => ({ courseId: id, userId, assignedById: actor.userId, dueAt })),
      ],
    });

    // Notify all affected users (§10.2).
    const teamMembers = newTeams.length
      ? await this.prisma.teamMember.findMany({
          where: { teamId: { in: newTeams } },
          select: { userId: true },
        })
      : [];
    const notifyIds = [...new Set([...newUsers, ...teamMembers.map((m) => m.userId)])].filter(
      (u) => u !== actor.userId,
    );
    await this.notifications.notifyMany(notifyIds, {
      type: 'kb.course_assigned',
      titleAr: `أُسند إليك كورس تدريبي: ${course.titleAr}`,
      titleEn: `Training course assigned: ${course.titleEn}`,
      payload: { entityType: 'course', entityId: id },
    });

    await this.audit.record({
      actorId: actor.userId,
      actorEmail: actor.email,
      action: 'kb.course_assign',
      entityType: 'course',
      entityId: id,
      after: { teamIds: newTeams, userIds: newUsers, dueAt: dto.dueAt },
      ...meta,
    });
    await this.timeline.record({
      entityType: 'course',
      entityId: id,
      eventType: 'assigned',
      actorId: actor.userId,
      payload: { teamIds: newTeams, userIds: newUsers },
    });
    return { assignedTeams: newTeams.length, assignedUsers: newUsers.length };
  }

  /** §10.3: last position / watch time / completion for the caller. */
  async recordProgress(
    actor: AuthUser,
    perms: Perms,
    lessonId: string,
    dto: LessonProgressDto,
    meta: Meta,
  ) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      include: { course: true },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.assertVisible(actor, perms, lesson.courseId); // blocked if not assigned (§10.2)

    const existing = await this.prisma.lessonProgress.findUnique({
      where: { lessonId_userId: { lessonId, userId: actor.userId } },
    });
    const progress = await this.prisma.lessonProgress.upsert({
      where: { lessonId_userId: { lessonId, userId: actor.userId } },
      update: {
        ...(dto.positionSeconds !== undefined ? { positionSeconds: dto.positionSeconds } : {}),
        ...(dto.watchTimeDeltaSeconds
          ? { watchTimeSeconds: (existing?.watchTimeSeconds ?? 0) + dto.watchTimeDeltaSeconds }
          : {}),
        ...(dto.completed !== undefined
          ? { completedAt: dto.completed ? (existing?.completedAt ?? new Date()) : null }
          : {}),
      },
      create: {
        lessonId,
        userId: actor.userId,
        positionSeconds: dto.positionSeconds ?? 0,
        watchTimeSeconds: dto.watchTimeDeltaSeconds ?? 0,
        completedAt: dto.completed ? new Date() : null,
      },
    });

    // Course-completion timeline event when the last lesson completes.
    if (dto.completed) {
      const [total, completed] = await this.prisma.$transaction([
        this.prisma.courseLesson.count({ where: { courseId: lesson.courseId } }),
        this.prisma.lessonProgress.count({
          where: {
            userId: actor.userId,
            completedAt: { not: null },
            lesson: { courseId: lesson.courseId },
          },
        }),
      ]);
      if (total > 0 && completed === total) {
        await this.timeline.record({
          entityType: 'course',
          entityId: lesson.courseId,
          eventType: 'completed_by_user',
          actorId: actor.userId,
        });
        await this.notifications.notify({
          userId: lesson.course.courseAdminId,
          type: 'kb.course_completed',
          titleAr: `أكمل متدرب الكورس: ${lesson.course.titleAr}`,
          titleEn: `A trainee completed the course: ${lesson.course.titleEn}`,
          payload: { entityType: 'course', entityId: lesson.courseId, userId: actor.userId },
        });
      }
    }
    void meta;
    return progress;
  }

  /** §10.2/§10.3 admin overview: per-user progress + last activity. */
  async progressOverview(actor: AuthUser, perms: Perms, id: string) {
    const course = await this.prisma.course.findFirst({ where: { id, deletedAt: null } });
    if (!course) throw new NotFoundException('Course not found');
    if (!this.canAdminister(actor, perms, course)) {
      throw new ForbiddenException('No access to course progress');
    }

    const lessons = await this.prisma.courseLesson.findMany({
      where: { courseId: id },
      select: { id: true },
    });
    const assignments = await this.prisma.courseAssignment.findMany({ where: { courseId: id } });
    const teamIds = assignments.map((a) => a.teamId).filter((t): t is string => !!t);
    const teamMembers = teamIds.length
      ? await this.prisma.teamMember.findMany({
          where: { teamId: { in: teamIds } },
          select: { userId: true },
        })
      : [];
    const userIds = [
      ...new Set([
        ...assignments.map((a) => a.userId).filter((u): u is string => !!u),
        ...teamMembers.map((m) => m.userId),
      ]),
    ];

    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, deletedAt: null },
      select: { id: true, nameAr: true, nameEn: true, email: true, lastSignInAt: true },
    });
    const allProgress = await this.prisma.lessonProgress.findMany({
      where: { userId: { in: userIds }, lessonId: { in: lessons.map((l) => l.id) } },
    });

    return users.map((u) => ({
      user: u, // includes lastSignInAt (§10.2)
      ...this.progressSummary(
        lessons.map((l) => l.id),
        allProgress.filter((p) => p.userId === u.id),
      ),
    }));
  }
}
