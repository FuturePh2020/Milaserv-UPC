import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Foundations#1';
const TAG = 'e2e-fnd';

describe('Settings / Audit / Notifications foundations (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let admin: { id: string; email: string };
  let member: { id: string; email: string };
  let dept: { id: string };
  let team: { id: string };

  async function login(email: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function cleanup() {
    await prisma.setting.deleteMany({ where: { scopeLevel: { not: 'SYSTEM' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { nameEn: { contains: TAG } } });
    await prisma.department.deleteMany({ where: { nameEn: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    dept = await prisma.department.create({
      data: { code: `EF${Date.now() % 100000}`, nameAr: 'إدارة', nameEn: `Dept ${TAG}` },
    });
    team = await prisma.team.create({
      data: { nameAr: 'فريق', nameEn: `Team ${TAG}`, departmentId: dept.id },
    });
    admin = await prisma.user.create({
      data: {
        email: `admin.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مدير',
        nameEn: `Admin ${TAG}`,
        roles: { create: { role: { connect: { key: 'SUPER_ADMIN' } } } },
      },
    });
    member = await prisma.user.create({
      data: {
        email: `member.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'عضو',
        nameEn: `Member ${TAG}`,
        departmentId: dept.id,
        roles: { create: { role: { connect: { key: 'AGENT' } } } },
      },
    });
    adminToken = await login(admin.email);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  describe('Settings (Configuration Engine, ADR-008)', () => {
    it('lists the seeded catalog', async () => {
      const res = await request(http)
        .get('/api/v1/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const keys = res.body.map((s: { key: string }) => s.key);
      expect(keys).toEqual(
        expect.arrayContaining(['general.platform_name', 'general.default_locale']),
      );
    });

    it('rejects a value of the wrong type (400) and unknown keys (404)', async () => {
      await request(http)
        .put('/api/v1/settings/notifications.in_app_enabled')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'yes-please' }) // BOOLEAN expected
        .expect(400);
      await request(http)
        .put('/api/v1/settings/not.a.real.key')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: true })
        .expect(404);
    });

    it('updates a SYSTEM value and records audit', async () => {
      await request(http)
        .put('/api/v1/settings/general.default_locale')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'en' })
        .expect(200);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'setting.update', actorId: admin.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit).toBeTruthy();

      // restore
      await request(http)
        .put('/api/v1/settings/general.default_locale')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'ar' })
        .expect(200);
    });

    it('supports department overrides with TEAM→DEPARTMENT→SYSTEM fallback', async () => {
      await request(http)
        .put('/api/v1/settings/general.default_locale')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: 'en', scopeLevel: 'DEPARTMENT', scopeId: dept.id })
        .expect(200);

      const rows = await prisma.setting.findMany({
        where: { key: 'general.default_locale' },
      });
      expect(rows).toHaveLength(2); // SYSTEM + DEPARTMENT override

      await request(http)
        .delete(
          `/api/v1/settings/general.default_locale/override?scopeLevel=DEPARTMENT&scopeId=${dept.id}`,
        )
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    });

    it('non-admin cannot manage settings (403)', async () => {
      const token = await login(member.email);
      await request(http)
        .put('/api/v1/settings/general.default_locale')
        .set('Authorization', `Bearer ${token}`)
        .send({ value: 'en' })
        .expect(403);
    });
  });

  describe('Audit query API', () => {
    it('admin can filter audit entries', async () => {
      const res = await request(http)
        .get('/api/v1/audit?action=setting.&pageSize=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.total).toBeGreaterThan(0);
      expect(res.body.items[0].action.startsWith('setting.')).toBe(true);
    });

    it('audit access requires audit.view (403 for agents)', async () => {
      const token = await login(member.email);
      await request(http).get('/api/v1/audit').set('Authorization', `Bearer ${token}`).expect(403);
    });

    it('DEPARTMENT-scoped reviewer sees only their department actors', async () => {
      const reviewer = await prisma.user.create({
        data: {
          email: `reviewer.${TAG}@milaserv360.test`,
          passwordHash: await argon2.hash(PASSWORD),
          nameAr: 'مراجع',
          nameEn: `Reviewer ${TAG}`,
          departmentId: dept.id,
          roles: { create: { role: { connect: { key: 'QUALITY_REVIEWER' } } } },
        },
      });
      const token = await login(reviewer.email);
      const res = await request(http)
        .get('/api/v1/audit?pageSize=100')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Admin (no department) actions and system rows must not be visible.
      const actorIds = res.body.items.map((a: { actorId: string | null }) => a.actorId);
      expect(actorIds).not.toContain(admin.id);
      expect(actorIds).not.toContain(null);
    });
  });

  describe('Notification center foundation', () => {
    it('team membership assignment produces an in-app notification', async () => {
      await request(http)
        .post(`/api/v1/teams/${team.id}/members`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ userId: member.id, role: 'MEMBER' })
        .expect(201);

      const token = await login(member.email);
      const list = await request(http)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(list.body.total).toBeGreaterThanOrEqual(1);
      expect(list.body.items[0].type).toBe('team.member_added');
      expect(list.body.items[0].titleAr).toContain('فريق');

      const unread = await request(http)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(unread.body.count).toBeGreaterThanOrEqual(1);

      await request(http)
        .post(`/api/v1/notifications/${list.body.items[0].id}/read`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      const after = await request(http)
        .get('/api/v1/notifications/unread-count')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(after.body.count).toBe(unread.body.count - 1);
    });

    it("users cannot read or mark others' notifications", async () => {
      const token = await login(member.email);
      const mine = await request(http)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const id = mine.body.items[0].id;

      const adminSide = await request(http)
        .post(`/api/v1/notifications/${id}/read`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(adminSide.status).toBe(404); // not theirs → not found, no leak
    });

    it('role change notifies the affected user', async () => {
      const role = await prisma.role.findUniqueOrThrow({ where: { key: 'READ_ONLY' } });
      await request(http)
        .put(`/api/v1/users/${member.id}/roles`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ roleIds: [role.id] })
        .expect(200);

      const token = await login(member.email);
      const list = await request(http)
        .get('/api/v1/notifications')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const types = list.body.items.map((n: { type: string }) => n.type);
      expect(types).toContain('user.roles_changed');
    });
  });
});
