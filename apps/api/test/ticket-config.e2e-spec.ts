import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Config#12345x';
const TAG = 'e2e-cfg';

describe('Ticketing configuration catalogs (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let agentToken: string;

  async function login(email: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken as string;
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.user.create({
      data: {
        email: `admin.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مدير',
        nameEn: `Admin ${TAG}`,
        roles: { create: { role: { connect: { key: 'SUPER_ADMIN' } } } },
      },
    });
    await prisma.user.create({
      data: {
        email: `agent.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: `Agent ${TAG}`,
        roles: { create: { role: { connect: { key: 'AGENT' } } } },
      },
    });
    adminToken = await login(`admin.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);
  });

  afterAll(async () => {
    try {
      await prisma.ticketCategory.deleteMany({ where: { key: 'E2E_TEST_CAT' } });
      await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('serves the blueprint catalogs to any ticket.view holder', async () => {
    const res = await request(http)
      .get('/api/v1/ticket-config')
      .set('Authorization', `Bearer ${agentToken}`) // AGENT has ticket.view
      .expect(200);

    const typeKeys = res.body.types.map((t: { key: string }) => t.key);
    expect(typeKeys).toEqual(expect.arrayContaining(['INTERNAL', 'BRANCH']));

    const internal = res.body.types.find((t: { key: string }) => t.key === 'INTERNAL');
    expect(internal.categories.map((c: { key: string }) => c.key)).toEqual([
      'INQUIRY',
      'COMPLAINT',
      'AVAILABILITY_CHECK',
      'ORDER_FOLLOW_UP',
    ]);
    const branch = res.body.types.find((t: { key: string }) => t.key === 'BRANCH');
    expect(branch.categories).toHaveLength(7); // §9.2 branch list

    expect(res.body.urgencies.map((u: { key: string }) => u.key)).toEqual([
      'LOW',
      'MODERATE',
      'CRITICAL',
    ]);
    expect(res.body.statuses).toHaveLength(7); // §9.3
    expect(res.body.updateTypes).toHaveLength(10); // §9.6
    expect(res.body.transitions.length).toBeGreaterThanOrEqual(16);
    // 4 types × 3 urgencies (INTERNAL/BRANCH + §13 ONLINE_ISSUE/ONLINE_REQUEST)
    expect(res.body.slaPolicies).toHaveLength(12);

    const waiting = res.body.updateTypes.find((u: { key: string }) => u.key === 'WAITING');
    expect(waiting.pausesSla).toBe(true);
  });

  it('agent cannot manage config (403); admin can create + archive a category', async () => {
    await request(http)
      .post('/api/v1/ticket-config/categories')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ typeKey: 'INTERNAL', key: 'E2E_TEST_CAT', nameAr: 'فئة', nameEn: 'E2E Cat' })
      .expect(403);

    const created = await request(http)
      .post('/api/v1/ticket-config/categories')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ typeKey: 'INTERNAL', key: 'E2E_TEST_CAT', nameAr: 'فئة اختبار', nameEn: 'E2E Cat' })
      .expect(201);

    // Archive: disappears from active catalogs but the row persists (history).
    await request(http)
      .patch(`/api/v1/ticket-config/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false })
      .expect(200);

    const catalogs = await request(http)
      .get('/api/v1/ticket-config')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const internal = catalogs.body.types.find((t: { key: string }) => t.key === 'INTERNAL');
    expect(
      internal.categories.find((c: { key: string }) => c.key === 'E2E_TEST_CAT'),
    ).toBeUndefined();

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ticket_config.category_update', entityId: created.body.id },
    });
    expect(audit).toBeTruthy();
  });

  it('SLA policy minutes are editable and audited', async () => {
    const policy = await prisma.slaPolicy.findFirst({
      where: { type: { key: 'INTERNAL' }, urgency: { key: 'CRITICAL' } },
    });
    expect(policy).toBeTruthy();

    await request(http)
      .patch(`/api/v1/ticket-config/sla-policies/${policy!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstResponseMinutes: 20 })
      .expect(200);

    const after = await prisma.slaPolicy.findUnique({ where: { id: policy!.id } });
    expect(after?.firstResponseMinutes).toBe(20);

    // restore the seeded default
    await request(http)
      .patch(`/api/v1/ticket-config/sla-policies/${policy!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstResponseMinutes: 30 })
      .expect(200);
  });
});
