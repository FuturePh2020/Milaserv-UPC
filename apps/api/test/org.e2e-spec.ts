import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'OrgTest#12345';
const TAG = 'e2e-org';

describe('Users / Departments / Teams (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let deptA: { id: string };
  let deptB: { id: string };
  let teamA1: { id: string };
  let leaderA1: { id: string; email: string };
  let managerA: { id: string; email: string };
  let userB: { id: string; email: string };

  async function login(email: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function mkUser(email: string, roleKey: string, departmentId?: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: `مستخدم ${TAG}`,
        nameEn: `User ${TAG}`,
        departmentId,
        roles: { create: { role: { connect: { key: roleKey } } } },
      },
    });
  }

  async function cleanup() {
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { nameEn: { contains: TAG } } });
    await prisma.department.deleteMany({ where: { nameEn: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    deptA = await prisma.department.create({
      data: { code: `EOA${Date.now() % 100000}`, nameAr: 'إدارة أ', nameEn: `Dept A ${TAG}` },
    });
    deptB = await prisma.department.create({
      data: { code: `EOB${Date.now() % 100000}`, nameAr: 'إدارة ب', nameEn: `Dept B ${TAG}` },
    });
    teamA1 = await prisma.team.create({
      data: { nameAr: 'فريق أ1', nameEn: `Team A1 ${TAG}`, departmentId: deptA.id },
    });

    const admin = await mkUser(`admin.${TAG}@milaserv360.test`, 'SUPER_ADMIN');
    managerA = await mkUser(`manager-a.${TAG}@milaserv360.test`, 'TEAM_MANAGER', deptA.id);
    leaderA1 = await mkUser(`leader-a1.${TAG}@milaserv360.test`, 'TEAM_LEADER', deptA.id);
    userB = await mkUser(`user-b.${TAG}@milaserv360.test`, 'AGENT', deptB.id);
    await prisma.teamMember.create({
      data: { teamId: teamA1.id, userId: leaderA1.id, role: 'LEADER' },
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

  it('admin creates a department; audit + timeline are recorded', async () => {
    const res = await request(http)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'CC-E2E', nameAr: 'خدمة العملاء', nameEn: `Customer Care ${TAG}` })
      .expect(201);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'department.create', entityId: res.body.id },
    });
    expect(audit).toBeTruthy();
    const timeline = await prisma.timelineEvent.findFirst({
      where: { entityType: 'department', entityId: res.body.id, eventType: 'created' },
    });
    expect(timeline).toBeTruthy();
  });

  it('duplicate department code is rejected with 409', async () => {
    await request(http)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'CC-E2E', nameAr: 'تكرار', nameEn: `Duplicate ${TAG}` })
      .expect(409);
  });

  it('department with active teams cannot be archived (409)', async () => {
    await request(http)
      .delete(`/api/v1/departments/${deptA.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  it('admin (ALL_DATA) sees users of every department', async () => {
    const res = await request(http)
      .get('/api/v1/users?pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const emails = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining([managerA.email, userB.email]));
  });

  it('TEAM_MANAGER (DEPARTMENT) sees only their department users', async () => {
    const token = await login(managerA.email);
    const res = await request(http)
      .get('/api/v1/users?pageSize=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const emails = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toContain(leaderA1.email);
    expect(emails).not.toContain(userB.email);
    // Reading a user outside the department scope → 404, not data leak.
    await request(http)
      .get(`/api/v1/users/${userB.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('TEAM_LEADER (MY_TEAM) sees only teammates', async () => {
    const token = await login(leaderA1.email);
    const res = await request(http)
      .get('/api/v1/users?pageSize=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const emails = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual([leaderA1.email]); // only member of Team A1
  });

  it('AGENT gets 403 on the users list', async () => {
    const token = await login(userB.email);
    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('creating a user with roles requires user.assign_roles', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: 'AGENT' } });
    const created = await request(http)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `created.${TAG}@milaserv360.test`,
        temporaryPassword: 'TempPass#12345',
        nameAr: 'موظف جديد',
        nameEn: `Created ${TAG}`,
        departmentId: deptA.id,
        roleIds: [role.id],
      })
      .expect(201);
    expect(created.body.mustChangePassword).toBe(true);
    expect(created.body.roles[0].role.key).toBe('AGENT');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.create', entityId: created.body.id },
    });
    expect(audit).toBeTruthy();
  });

  it('deactivation revokes sessions immediately', async () => {
    const victim = await mkUser(`victim.${TAG}@milaserv360.test`, 'AGENT', deptA.id);
    const victimLogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: victim.email, password: PASSWORD })
      .expect(200);

    await request(http)
      .patch(`/api/v1/users/${victim.id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'INACTIVE' })
      .expect(200);

    // Refresh token no longer works.
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: victimLogin.body.refreshToken })
      .expect(401);
    // And login is refused.
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: victim.email, password: PASSWORD })
      .expect(401);
  });

  it('team membership changes flow into user timeline and scopes', async () => {
    const newbie = await mkUser(`newbie.${TAG}@milaserv360.test`, 'AGENT', deptA.id);
    await request(http)
      .post(`/api/v1/teams/${teamA1.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: newbie.id, role: 'MEMBER' })
      .expect(201);

    const timeline = await prisma.timelineEvent.findFirst({
      where: { entityType: 'user', entityId: newbie.id, eventType: 'joined_team' },
    });
    expect(timeline).toBeTruthy();

    // Leader now sees the newbie via MY_TEAM scope (perm cache was invalidated).
    const leaderToken = await login(leaderA1.email);
    const res = await request(http)
      .get('/api/v1/users?pageSize=100')
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(200);
    const emails = res.body.items.map((u: { email: string }) => u.email);
    expect(emails).toEqual(expect.arrayContaining([leaderA1.email, newbie.email]));

    // Duplicate membership → 409.
    await request(http)
      .post(`/api/v1/teams/${teamA1.id}/members`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ userId: newbie.id, role: 'MEMBER' })
      .expect(409);
  });

  it('role changes update effective permissions (cache invalidated)', async () => {
    const promotee = await mkUser(`promotee.${TAG}@milaserv360.test`, 'AGENT', deptA.id);
    const token = await login(promotee.email);
    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(403);

    const managerRole = await prisma.role.findUniqueOrThrow({ where: { key: 'TEAM_MANAGER' } });
    await request(http)
      .put(`/api/v1/users/${promotee.id}/roles`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ roleIds: [managerRole.id] })
      .expect(200);

    await request(http).get('/api/v1/users').set('Authorization', `Bearer ${token}`).expect(200);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'user.roles_change', entityId: promotee.id },
    });
    expect(audit).toBeTruthy();
  });

  it('system roles cannot be deleted; custom roles work end-to-end', async () => {
    const sys = await prisma.role.findUniqueOrThrow({ where: { key: 'AGENT' } });
    await request(http)
      .delete(`/api/v1/roles/${sys.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    const created = await request(http)
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        key: 'E2E_CUSTOM_ROLE',
        nameAr: 'دور مخصص',
        nameEn: 'Custom role',
        grants: [{ permissionKey: 'user.view', dataScope: 'DEPARTMENT' }],
      })
      .expect(201);
    expect(created.body.permissions[0].permission.key).toBe('user.view');

    await request(http)
      .delete(`/api/v1/roles/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    await prisma.role.deleteMany({ where: { key: 'E2E_CUSTOM_ROLE' } });
  });
});
