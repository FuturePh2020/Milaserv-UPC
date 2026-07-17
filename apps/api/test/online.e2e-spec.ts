import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { IntegrationsService } from '../src/modules/integrations/integrations.service';

const prisma = new PrismaClient();
const PASSWORD = 'Online#12345';
const TAG = 'e2e-online';

describe('Online Operation & Integrations (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let integrations: IntegrationsService;
  let managerToken: string;
  let agentToken: string;
  let ingestToken: string;
  let ingestUser: { id: string };
  let issueTicketId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setSetting = (key: string, value: unknown) =>
    prisma.setting.update({
      where: { key_scopeLevel_scopeId: { key, scopeLevel: 'SYSTEM', scopeId: '' } },
      data: { value: value as never },
    });

  async function cleanup() {
    await prisma.ticket.deleteMany({ where: { subject: { contains: TAG } } });
    await prisma.onlineOrder.deleteMany({ where: { externalNumber: { contains: 'EONL' } } });
    await prisma.integrationOperation.deleteMany({ where: { integrationKey: 'ordering' } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    const teams = await prisma.team.findMany({ where: { nameEn: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
    await prisma.department.deleteMany({ where: { code: 'EONL' } });
    await setSetting('integrations.ordering.outbound_enabled', false);
    await setSetting('integrations.retry.max_attempts', 5);
  }

  async function createUser(email: string, roleKey: string, deptId: string, team?: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: `User ${email.split('@')[0]}`,
        departmentId: deptId,
        roles: { create: { role: { connect: { key: roleKey } } } },
        ...(team ? { teams: { create: { teamId: team } } } : {}),
      },
    });
  }

  async function login(email: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    integrations = app.get(IntegrationsService);
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: 'EONL', nameAr: 'قسم الأونلاين', nameEn: `Online Dept ${TAG}` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق الأونلاين', nameEn: `Online Team ${TAG}`, departmentId: dept.id },
    });

    await createUser(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER', dept.id, team.id);
    await createUser(`agent.${TAG}@milaserv360.test`, 'AGENT', dept.id, team.id);
    ingestUser = await createUser(`ingest.${TAG}@milaserv360.test`, 'INTEGRATION_SUPPORT', dept.id);

    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);
    ingestToken = await login(`ingest.${TAG}@milaserv360.test`);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('ON-1 permissions: agent cannot ingest or open the monitor', async () => {
    await request(http)
      .post('/api/v1/online/orders/ingest')
      .set(auth(agentToken))
      .send({ orders: [] })
      .expect(403);
    await request(http).get('/api/v1/integrations/monitor').set(auth(agentToken)).expect(403);
  });

  it('ON-2 order ingest is idempotent with per-row rejections (§13 Daily Orders / F4)', async () => {
    const today = new Date().toISOString();
    const res = await request(http)
      .post('/api/v1/online/orders/ingest')
      .set(auth(ingestToken))
      .send({
        orders: [
          { externalNumber: 'EONL-1001', orderSourceKey: 'APP', orderedAt: today, value: 120.5 },
          { externalNumber: 'EONL-1002', orderSourceKey: 'WEBSITE', orderedAt: today },
          { externalNumber: 'EONL-1003', orderSourceKey: 'NOPE', orderedAt: today },
        ],
      })
      .expect(200);
    expect(res.body.accepted).toBe(2);
    expect(res.body.rejected).toHaveLength(1);

    // Re-send with a corrected value: updates in place.
    await request(http)
      .post('/api/v1/online/orders/ingest')
      .set(auth(ingestToken))
      .send({
        orders: [
          { externalNumber: 'EONL-1001', orderSourceKey: 'APP', orderedAt: today, value: 99 },
        ],
      })
      .expect(200);
    const stored = await prisma.onlineOrder.findMany({
      where: { externalNumber: 'EONL-1001' },
    });
    expect(stored).toHaveLength(1);
    expect(Number(stored[0]!.value)).toBe(99);
  });

  it('ON-3 orders list with filters (§13 Order Source)', async () => {
    const res = await request(http)
      .get('/api/v1/online/orders?sourceKey=APP&q=EONL')
      .set(auth(agentToken))
      .expect(200);
    const numbers = (res.body.items as { externalNumber: string }[]).map((o) => o.externalNumber);
    expect(numbers).toContain('EONL-1001');
    expect(numbers).not.toContain('EONL-1002');
  });

  it('ON-4 online issues ride the ticket engine with Request Source (F1/F3)', async () => {
    await request(http)
      .post('/api/v1/tickets')
      .set(auth(managerToken))
      .send({
        typeKey: 'ONLINE_ISSUE',
        categoryKey: 'GENERAL',
        urgencyKey: 'MODERATE',
        customerName: 'عميل أونلاين',
        customerPhone: '0500000010',
        subject: `${TAG} bad source`,
        description: 'online issue with bad source',
        requestSourceKey: 'NOPE',
      })
      .expect(400);

    const created = await request(http)
      .post('/api/v1/tickets')
      .set(auth(managerToken))
      .send({
        typeKey: 'ONLINE_ISSUE',
        categoryKey: 'GENERAL',
        urgencyKey: 'MODERATE',
        customerName: 'عميل أونلاين',
        customerPhone: '0500000010',
        subject: `${TAG} delayed order`,
        description: 'order arrived late',
        requestSourceKey: 'APP',
        relatedOrderNo: 'EONL-1001',
      })
      .expect(201);
    issueTicketId = created.body.id;
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: issueTicketId } });
    expect(ticket.requestSourceKey).toBe('APP');
    expect(ticket.relatedOrderNo).toBe('EONL-1001');
    // SLA policy exists for the online type (generated by the seed).
    expect(ticket.slaPolicyId).not.toBeNull();
  });

  it('ON-5 resolving an online ticket enqueues the outbound sync op (F5)', async () => {
    await setSetting('integrations.ordering.outbound_enabled', true);

    await request(http)
      .post(`/api/v1/tickets/${issueTicketId}/take`)
      .set(auth(managerToken))
      .expect(201);
    await request(http)
      .post(`/api/v1/tickets/${issueTicketId}/resolve`)
      .set(auth(managerToken))
      .send({
        summary: 'refunded and apologized',
        rootCause: 'courier delay',
        actionTaken: 'refund issued',
        finalSolution: 'customer satisfied',
        resolutionCategoryKey: 'RESOLVED_SERVICE',
        customerInformed: true,
      })
      .expect(201);

    const op = await prisma.integrationOperation.findFirst({
      where: { integrationKey: 'ordering', operation: 'issue_resolved' },
    });
    expect(op).toBeTruthy();
    expect(op!.status).toBe('PENDING');
    expect((op!.payload as { relatedOrderNo?: string }).relatedOrderNo).toBe('EONL-1001');
  });

  it('ON-6 stats return the §13 day counters (F6)', async () => {
    const res = await request(http).get('/api/v1/online/stats').set(auth(agentToken)).expect(200);
    expect(res.body.dailyOrders).toBeGreaterThanOrEqual(2);
    expect(res.body.issues.handledToday).toBeGreaterThanOrEqual(1);
    expect(res.body.avgHandlingMinutes).not.toBeNull();
    expect(res.body.slaAchievementPct).toBe(100);
  });

  it('ON-7 unconfigured endpoint → FAILED with exponential backoff (§13 note)', async () => {
    const result = await integrations.processDue();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const op = await prisma.integrationOperation.findFirstOrThrow({
      where: { integrationKey: 'ordering', operation: 'issue_resolved' },
    });
    expect(op.status).toBe('FAILED');
    expect(op.attempts).toBe(1);
    expect(op.lastError).toContain('not configured');
    expect(op.nextRetryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('ON-8 exhausted retries go DEAD and alert admins (§13 Monitor alert)', async () => {
    await setSetting('integrations.retry.max_attempts', 2);
    const op = await prisma.integrationOperation.findFirstOrThrow({
      where: { integrationKey: 'ordering', operation: 'issue_resolved' },
    });
    await prisma.integrationOperation.update({
      where: { id: op.id },
      data: { nextRetryAt: new Date(Date.now() - 1000) },
    });

    const result = await integrations.processDue();
    expect(result.dead).toBeGreaterThanOrEqual(1);

    const deadOp = await prisma.integrationOperation.findUniqueOrThrow({ where: { id: op.id } });
    expect(deadOp.status).toBe('DEAD');

    const alert = await prisma.notification.findFirst({
      where: { userId: ingestUser.id, type: 'integration.dead' },
    });
    expect(alert).toBeTruthy();
  });

  it('ON-9 monitor shows health; manual retry re-queues (§13)', async () => {
    const monitor = await request(http)
      .get('/api/v1/integrations/monitor')
      .set(auth(ingestToken))
      .expect(200);
    const ordering = (
      monitor.body.integrations as { integrationKey: string; counts: Record<string, number> }[]
    ).find((x) => x.integrationKey === 'ordering');
    expect(ordering).toBeTruthy();
    expect(ordering!.counts.DEAD).toBeGreaterThanOrEqual(1);
    expect(ordering!.lastError ?? '').toContain('not configured');

    const op = await prisma.integrationOperation.findFirstOrThrow({
      where: { integrationKey: 'ordering', status: 'DEAD' },
    });
    const retried = await request(http)
      .post(`/api/v1/integrations/operations/${op.id}/retry`)
      .set(auth(ingestToken))
      .expect(200);
    expect(retried.body.status).toBe('PENDING');
    expect(retried.body.attempts).toBe(0);
  });

  it('ON-10 non-online tickets never enqueue outbound sync', async () => {
    const before = await prisma.integrationOperation.count();
    const created = await request(http)
      .post('/api/v1/tickets')
      .set(auth(managerToken))
      .send({
        typeKey: 'INTERNAL',
        categoryKey: 'INQUIRY',
        urgencyKey: 'LOW',
        customerName: 'عميل',
        customerPhone: '0500000011',
        subject: `${TAG} internal ticket`,
        description: 'ordinary internal inquiry',
      })
      .expect(201);
    await request(http)
      .post(`/api/v1/tickets/${created.body.id}/take`)
      .set(auth(managerToken))
      .expect(201);
    await request(http)
      .post(`/api/v1/tickets/${created.body.id}/resolve`)
      .set(auth(managerToken))
      .send({
        summary: 'answered the inquiry',
        rootCause: 'n/a',
        actionTaken: 'answered',
        finalSolution: 'done',
        resolutionCategoryKey: 'RESOLVED_SERVICE',
        customerInformed: true,
      })
      .expect(201);
    expect(await prisma.integrationOperation.count()).toBe(before);
  });
});
