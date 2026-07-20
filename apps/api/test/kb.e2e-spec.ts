import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'KbTest#12345';
const TAG = 'e2e-kb';

describe('Knowledge Base Basic (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let memberToken: string;
  let outsiderToken: string;
  let member: { id: string };
  let team: { id: string };

  async function login(email: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function mkUser(email: string, roleKey: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مستخدم',
        nameEn: `User ${TAG}`,
        roles: { create: { role: { connect: { key: roleKey } } } },
      },
    });
  }

  async function cleanup() {
    await prisma.course.deleteMany({ where: { titleEn: { contains: TAG } } });
    await prisma.kbContent.deleteMany({ where: { titleEn: { contains: TAG } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { nameEn: { contains: TAG } } });
    await prisma.department.deleteMany({ where: { nameEn: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: `EKB${Date.now() % 100000}`, nameAr: 'إدارة', nameEn: `Dept ${TAG}` },
    });
    team = await prisma.team.create({
      data: { nameAr: 'فريق', nameEn: `Team ${TAG}`, departmentId: dept.id },
    });
    await mkUser(`admin.${TAG}@milaserv360.test`, 'SUPER_ADMIN');
    member = await mkUser(`member.${TAG}@milaserv360.test`, 'AGENT');
    await mkUser(`outsider.${TAG}@milaserv360.test`, 'AGENT');
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: member.id, role: 'MEMBER' },
    });

    adminToken = await login(`admin.${TAG}@milaserv360.test`);
    memberToken = await login(`member.${TAG}@milaserv360.test`);
    outsiderToken = await login(`outsider.${TAG}@milaserv360.test`);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  describe('Content library (§10.1/§10.4)', () => {
    let contentId: string;

    it('creates an SOP draft (kb.manage); agents cannot create (403)', async () => {
      await request(http)
        .post('/api/v1/kb/contents')
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ kind: 'SOP', titleAr: 'إجراء', titleEn: `SOP ${TAG}` })
        .expect(403);

      const res = await request(http)
        .post('/api/v1/kb/contents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          kind: 'SOP',
          titleAr: 'إجراء الاسترجاع',
          titleEn: `Refund SOP ${TAG}`,
          body: 'Step 1 … Step 2 …',
        })
        .expect(201);
      contentId = res.body.id;
      expect(res.body.status).toBe('DRAFT');
      expect(res.body.rootId).toBe(contentId);
      expect(res.body.version).toBe(1);
    });

    it('drafts are hidden from viewers until published', async () => {
      const list = await request(http)
        .get('/api/v1/kb/contents')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(list.body.items.find((c: { id: string }) => c.id === contentId)).toBeUndefined();

      await request(http)
        .post(`/api/v1/kb/contents/${contentId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      const after = await request(http)
        .get('/api/v1/kb/contents')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(after.body.items.find((c: { id: string }) => c.id === contentId)).toBeTruthy();
    });

    it('published content is immutable; new version flow archives the old one (§10.4)', async () => {
      await request(http)
        .patch(`/api/v1/kb/contents/${contentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ titleEn: `Changed ${TAG}` })
        .expect(400); // published = immutable

      const v2 = await request(http)
        .post(`/api/v1/kb/contents/${contentId}/new-version`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      expect(v2.body.version).toBe(2);
      expect(v2.body.status).toBe('DRAFT');

      await request(http)
        .patch(`/api/v1/kb/contents/${v2.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ titleEn: `Refund SOP v2 ${TAG}` })
        .expect(200);
      await request(http)
        .post(`/api/v1/kb/contents/${v2.body.id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);

      // v1 archived but retained (history), v2 published.
      const v1 = await prisma.kbContent.findUniqueOrThrow({ where: { id: contentId } });
      expect(v1.status).toBe('ARCHIVED');
      const detail = await request(http)
        .get(`/api/v1/kb/contents/${v2.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(detail.body.versions).toHaveLength(2);
    });

    it('expired content disappears for viewers but not for kb.manage (B3)', async () => {
      const expired = await request(http)
        .post('/api/v1/kb/contents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          kind: 'DAILY_NOTE',
          titleAr: 'ملاحظة',
          titleEn: `Expired note ${TAG}`,
          expiryAt: new Date(Date.now() + 60_000).toISOString(),
        })
        .expect(201);
      await request(http)
        .post(`/api/v1/kb/contents/${expired.body.id}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
      await prisma.kbContent.update({
        where: { id: expired.body.id },
        data: { expiryAt: new Date(Date.now() - 60_000) },
      });

      await request(http)
        .get(`/api/v1/kb/contents/${expired.body.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(404);
      await request(http)
        .get(`/api/v1/kb/contents/${expired.body.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });
  });

  describe('Courses & progress (§10.2/§10.3)', () => {
    let courseId: string;
    let lesson1: string;
    let lesson2: string;

    it('creates a course with lessons; publish requires a lesson', async () => {
      const course = await request(http)
        .post('/api/v1/kb/courses')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ titleAr: 'كورس خدمة العملاء', titleEn: `CС Course ${TAG}` })
        .expect(201);
      courseId = course.body.id;

      await request(http)
        .post(`/api/v1/kb/courses/${courseId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400); // no lessons yet

      const l1 = await request(http)
        .post(`/api/v1/kb/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ titleAr: 'مقدمة', titleEn: 'Intro', videoUrl: 'https://example.com/v1' })
        .expect(201);
      lesson1 = l1.body.id;
      const l2 = await request(http)
        .post(`/api/v1/kb/courses/${courseId}/lessons`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ titleAr: 'التطبيق', titleEn: 'Practice' })
        .expect(201);
      lesson2 = l2.body.id;
      expect(l2.body.order).toBe(2);

      await request(http)
        .post(`/api/v1/kb/courses/${courseId}/publish`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(201);
    });

    it('unassigned users cannot see the course (§10.2); team assignment notifies members', async () => {
      await request(http)
        .get(`/api/v1/kb/courses/${courseId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(404);

      await request(http)
        .post(`/api/v1/kb/courses/${courseId}/assign`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ teamIds: [team.id] })
        .expect(201);

      // Assigned member now sees it; outsider still blocked.
      await request(http)
        .get(`/api/v1/kb/courses/${courseId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      await request(http)
        .get(`/api/v1/kb/courses/${courseId}`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .expect(404);

      const notification = await prisma.notification.findFirst({
        where: { userId: member.id, type: 'kb.course_assigned' },
      });
      expect(notification).toBeTruthy();
    });

    it('member cannot assign (not admin/kb.assign) — 403', async () => {
      await request(http)
        .post(`/api/v1/kb/courses/${courseId}/assign`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ userIds: [member.id] })
        .expect(403);
    });

    it('progress lifecycle: NOT_STARTED → IN_PROGRESS → COMPLETED with §10.3 indicators', async () => {
      let list = await request(http)
        .get('/api/v1/kb/courses')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      let mine = list.body.find((c: { id: string }) => c.id === courseId);
      expect(mine.myProgress.status).toBe('NOT_STARTED');

      // Watch lesson 1 partially: position + watch time.
      await request(http)
        .post(`/api/v1/kb/lessons/${lesson1}/progress`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ positionSeconds: 120, watchTimeDeltaSeconds: 120 })
        .expect(201);
      // Outsider blocked from recording progress (§10.2).
      await request(http)
        .post(`/api/v1/kb/lessons/${lesson1}/progress`)
        .set('Authorization', `Bearer ${outsiderToken}`)
        .send({ positionSeconds: 5 })
        .expect(404);

      list = await request(http)
        .get('/api/v1/kb/courses')
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      mine = list.body.find((c: { id: string }) => c.id === courseId);
      expect(mine.myProgress.status).toBe('IN_PROGRESS');
      expect(mine.myProgress.watchTimeSeconds).toBe(120);

      // Complete both lessons → COMPLETED, 100%, admin notified.
      await request(http)
        .post(`/api/v1/kb/lessons/${lesson1}/progress`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ completed: true, watchTimeDeltaSeconds: 60 })
        .expect(201);
      await request(http)
        .post(`/api/v1/kb/lessons/${lesson2}/progress`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ completed: true })
        .expect(201);

      const detail = await request(http)
        .get(`/api/v1/kb/courses/${courseId}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(200);
      expect(detail.body.myProgress.status).toBe('COMPLETED');
      expect(detail.body.myProgress.progressPct).toBe(100);
      expect(detail.body.lessons[0].myProgress.positionSeconds).toBe(120); // Last Position (§10.3)

      const completionEvent = await prisma.timelineEvent.findFirst({
        where: { entityType: 'course', entityId: courseId, eventType: 'completed_by_user' },
      });
      expect(completionEvent).toBeTruthy();
    });

    it('admin overview shows per-user progress incl. last sign-in (§10.2)', async () => {
      const overview = await request(http)
        .get(`/api/v1/kb/courses/${courseId}/progress`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const row = overview.body.find((r: { user: { id: string } }) => r.user.id === member.id);
      expect(row.status).toBe('COMPLETED');
      expect(row.progressPct).toBe(100);
      expect(row.user.lastSignInAt).toBeTruthy();
      expect(row.lastActivityAt).toBeTruthy();

      // Member (no admin rights) cannot read the overview.
      await request(http)
        .get(`/api/v1/kb/courses/${courseId}/progress`)
        .set('Authorization', `Bearer ${memberToken}`)
        .expect(403);
    });
  });
});
