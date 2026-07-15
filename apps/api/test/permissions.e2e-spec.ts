import type { INestApplication } from '@nestjs/common';
import { Controller, Get, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { RequirePermission } from '../src/modules/permissions/require-permission.decorator';
import { PermissionScope } from '../src/modules/permissions/permission-scope.decorator';
import type { RequestScope } from '../src/modules/permissions/scope';

const prisma = new PrismaClient();
const PASSWORD = 'ScopeTest#123';
const EMAILS = {
  admin: 'e2e-perm-admin@milaserv360.test',
  leader: 'e2e-perm-leader@milaserv360.test',
  agent: 'e2e-perm-agent@milaserv360.test',
};

/** Test-only endpoint proving guard enforcement + scope attachment. */
@Controller('perm-probe')
class ProbeController {
  @RequirePermission('user.view')
  @Get()
  probe(@PermissionScope() scope: RequestScope) {
    return { scope: scope.scope, teamIds: scope.context.teamIds };
  }
}

describe('Permissions engine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let teamId: string;

  async function createUser(email: string, roleKey: string | null) {
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'اختبار الصلاحيات',
        nameEn: 'Perm Test',
        ...(roleKey ? { roles: { create: { role: { connect: { key: roleKey } } } } } : {}),
      },
    });
    return user;
  }

  async function login(email: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    http = app.getHttpServer();

    await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });

    // Org fixture: department + team; leader belongs to the team.
    const dept = await prisma.department.create({
      data: { code: `E2E-${Date.now()}`, nameAr: 'إدارة اختبار', nameEn: 'E2E Dept' },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق اختبار', nameEn: 'E2E Team', departmentId: dept.id },
    });
    teamId = team.id;

    await createUser(EMAILS.admin, 'SUPER_ADMIN');
    const leader = await createUser(EMAILS.leader, 'TEAM_LEADER');
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: leader.id, role: 'LEADER' },
    });
    await createUser(EMAILS.agent, 'AGENT');
  });

  afterAll(async () => {
    try {
      await prisma.user.deleteMany({ where: { email: { in: Object.values(EMAILS) } } });
      await prisma.team.deleteMany({ where: { nameEn: 'E2E Team' } });
      await prisma.department.deleteMany({ where: { nameEn: 'E2E Dept' } });
    } finally {
      // Always release connections — otherwise a cleanup failure hangs jest.
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('SUPER_ADMIN gets the full catalog with ALL_DATA scope', async () => {
    const token = await login(EMAILS.admin);
    const res = await request(http)
      .get('/api/v1/me/permissions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.permissions['user.view'].scope).toBe('ALL_DATA');
    expect(res.body.permissions['role.manage'].scope).toBe('ALL_DATA');
    expect(Object.keys(res.body.permissions).length).toBeGreaterThanOrEqual(15);
  });

  it('TEAM_LEADER resolves user.view at MY_TEAM scope with their team ids', async () => {
    const token = await login(EMAILS.leader);
    const res = await request(http)
      .get('/api/v1/me/permissions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.permissions['user.view'].scope).toBe('MY_TEAM');
    expect(res.body.permissions['role.manage']).toBeUndefined();
    expect(res.body.teamIds).toContain(teamId);
  });

  it('AGENT has no admin permissions', async () => {
    const token = await login(EMAILS.agent);
    const res = await request(http)
      .get('/api/v1/me/permissions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.permissions).toEqual({});
  });

  it('guard: 403 without the permission, 200 with it (scope attached)', async () => {
    const agentToken = await login(EMAILS.agent);
    await request(http)
      .get('/api/v1/perm-probe')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(403);

    const leaderToken = await login(EMAILS.leader);
    const ok = await request(http)
      .get('/api/v1/perm-probe')
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(200);
    expect(ok.body.scope).toBe('MY_TEAM');
    expect(ok.body.teamIds).toContain(teamId);

    // Unauthenticated request never reaches the permission layer.
    await request(http).get('/api/v1/perm-probe').expect(401);
  });

  it('multi-role users get the widest scope per permission', async () => {
    const email = 'e2e-perm-multi@milaserv360.test';
    await prisma.user.deleteMany({ where: { email } });
    await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'متعدد الأدوار',
        nameEn: 'Multi Role',
        roles: {
          create: [
            { role: { connect: { key: 'TEAM_LEADER' } } }, // user.view @ MY_TEAM
            { role: { connect: { key: 'TEAM_MANAGER' } } }, // user.view @ DEPARTMENT
          ],
        },
      },
    });

    const token = await login(email);
    const res = await request(http)
      .get('/api/v1/me/permissions')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.permissions['user.view'].scope).toBe('DEPARTMENT');

    await prisma.user.deleteMany({ where: { email } });
  });
});
