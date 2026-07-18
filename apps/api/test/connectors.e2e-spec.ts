import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { IntegrationsService } from '../src/modules/integrations/integrations.service';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const prisma = new PrismaClient();
const PASSWORD = 'Conn#12345';
const TAG = 'e2e-conn';
const YEASTAR_TOKEN = 'yst-secret-1';
const ORDERING_TOKEN = 'ord-secret-1';

describe('§21 Connectors (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let integrations: IntegrationsService;
  let notifications: NotificationsService;
  let managerToken: string;
  let agentToken: string;
  let ingestToken: string;
  let agent: { id: string };
  let teamId: string;
  let stub: Server;
  let stubPort: number;
  let drugId: string;
  let branchIds: string[] = [];

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setSetting = (key: string, value: unknown) =>
    prisma.setting.update({
      where: { key_scopeLevel_scopeId: { key, scopeLevel: 'SYSTEM', scopeId: '' } },
      data: { value: value as never },
    });

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { contains: TAG } } });
    const userIds = users.map((u) => u.id);
    const teams = await prisma.team.findMany({ where: { nameEn: { contains: TAG } } });
    await prisma.metricValue.deleteMany({
      where: { scopeId: { in: [...userIds, ...teams.map((t) => t.id)] } },
    });
    await prisma.ticket.deleteMany({ where: { subject: { contains: TAG } } });
    await prisma.onlineOrder.deleteMany({ where: { externalNumber: { startsWith: 'ECONN' } } });
    await prisma.integrationOperation.deleteMany({
      where: { integrationKey: { in: ['email', 'sms', 'dbs'] } },
    });
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9ECONN' } } });
    await prisma.branch.deleteMany({ where: { code: { startsWith: 'ECONN' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
    await prisma.department.deleteMany({ where: { code: 'ECONN' } });
    await setSetting('integrations.yeastar.inbound_token', '');
    await setSetting('integrations.ordering.inbound_token', '');
    await setSetting('integrations.dbs.enabled', false);
    await setSetting('integrations.dbs.endpoint', '');
    await setSetting('integrations.email.endpoint', '');
    await setSetting('notifications.email_enabled', false);
    await setSetting('integrations.sms.enabled', false);
    await setSetting('integrations.sms.endpoint', '');
    await setSetting('integrations.maps.endpoint', '');
  }

  async function createUser(email: string, roleKey: string, deptId: string, team: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: `User ${email.split('@')[0]}`,
        departmentId: deptId,
        roles: { create: { role: { connect: { key: roleKey } } } },
        teams: { create: { teamId: team } },
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
    notifications = app.get(NotificationsService);
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: 'ECONN', nameAr: 'قسم التكاملات', nameEn: `Connectors Dept ${TAG}` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق التكاملات', nameEn: `Connectors Team ${TAG}`, departmentId: dept.id },
    });
    teamId = team.id;
    await createUser(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER', dept.id, team.id);
    agent = await createUser(`agent.${TAG}@milaserv360.test`, 'AGENT', dept.id, team.id);
    await createUser(`ingest.${TAG}@milaserv360.test`, 'INTEGRATION_SUPPORT', dept.id, team.id);
    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);
    ingestToken = await login(`ingest.${TAG}@milaserv360.test`);

    const drug = await prisma.drug.create({
      data: { materialNo: '9ECONN1', nameEn: 'Conntestol 100mg', availability: { Jeddah: 1 } },
    });
    drugId = drug.id;

    const mk = (code: string, lat: number, lng: number) =>
      prisma.branch.create({
        data: {
          code,
          nameAr: `فرع ${code}`,
          nameEn: `Branch ${code} ${TAG}`,
          latitude: lat,
          longitude: lng,
          deliveryCovered: true,
          supervisorName: 'Conn Supervisor',
          supervisorEmail: `supervisor.${TAG}@branches.test`,
        },
      });
    const b1 = await mk('ECONN1', 30.98, 38.05);
    const b2 = await mk('ECONN2', 30.99, 38.07);
    branchIds = [b1.id, b2.id];

    // One stub bridge for DBS + Maps.
    stub = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/dbs') {
          res.end(JSON.stringify({ availability: { Riyadh: 55, Jeddah: 8, Bad: 'x' } }));
        } else if (req.url === '/maps') {
          const parsed = JSON.parse(body) as { destinations: { id: string }[] };
          res.end(
            JSON.stringify({
              distances: parsed.destinations.map((d, i) => ({
                id: d.id,
                km: 5 + i,
                minutes: 12 + i,
              })),
            }),
          );
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address();
    stubPort = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('CN-1 inbound webhooks are dead until a token is configured (J7)', async () => {
    await request(http)
      .post('/api/v1/integrations/yeastar/events')
      .send({
        events: [{ agentEmail: `agent.${TAG}@milaserv360.test`, direction: 'in', answered: true }],
      })
      .expect(403);

    await setSetting('integrations.yeastar.inbound_token', YEASTAR_TOKEN);
    await request(http)
      .post('/api/v1/integrations/yeastar/events')
      .set('X-Integration-Token', 'wrong-token')
      .send({
        events: [{ agentEmail: `agent.${TAG}@milaserv360.test`, direction: 'in', answered: true }],
      })
      .expect(403);
  });

  it('CN-2 Yeastar events land as §12 metric values per user and team (J1)', async () => {
    const res = await request(http)
      .post('/api/v1/integrations/yeastar/events')
      .set('X-Integration-Token', YEASTAR_TOKEN)
      .send({
        events: [
          {
            agentEmail: `agent.${TAG}@milaserv360.test`,
            direction: 'in',
            answered: true,
            queue: 'CC',
            talkSeconds: 120,
          },
          {
            agentEmail: `agent.${TAG}@milaserv360.test`,
            direction: 'in',
            answered: true,
            talkSeconds: 90,
          },
          {
            agentEmail: `agent.${TAG}@milaserv360.test`,
            direction: 'in',
            answered: false,
            queue: 'CC',
          },
          {
            agentEmail: `agent.${TAG}@milaserv360.test`,
            direction: 'out',
            answered: true,
            talkSeconds: 30,
          },
          { agentEmail: `ghost.${TAG}@nowhere.test`, direction: 'in', answered: true },
        ],
      })
      .expect(200);
    expect(res.body.accepted).toBe(4);
    expect(res.body.rejected).toHaveLength(1);
    expect(res.body.rejected[0].reason).toContain('Unknown agent');

    const read = async (scopeType: 'USER' | 'TEAM', scopeId: string) => {
      const rows = await prisma.metricValue.findMany({ where: { scopeType, scopeId } });
      return Object.fromEntries(rows.map((r) => [r.metricKey, Number(r.value)]));
    };
    const user = await read('USER', agent.id);
    expect(user.total_calls).toBe(4);
    expect(user.inbound_calls).toBe(2);
    expect(user.missed_calls).toBe(1);
    expect(user.abandoned_calls).toBe(1);
    expect(user.outbound_calls).toBe(1);
    expect(user.outbound_calls_answered).toBe(1);
    expect(user.queue_calls_answered).toBe(1);
    expect(user.total_talk_time).toBe(240);
    const team = await read('TEAM', teamId);
    expect(team.total_calls).toBe(4);
    expect(team.total_talk_time).toBe(240);

    // A second push increments — the PBX reports deltas, not snapshots.
    await request(http)
      .post('/api/v1/integrations/yeastar/events')
      .set('X-Integration-Token', YEASTAR_TOKEN)
      .send({
        events: [
          {
            agentEmail: `agent.${TAG}@milaserv360.test`,
            direction: 'in',
            answered: true,
            talkSeconds: 10,
          },
        ],
      })
      .expect(200);
    const after = await read('USER', agent.id);
    expect(after.inbound_calls).toBe(3);
    expect(after.total_talk_time).toBe(250);
  });

  it('CN-3 Ordering webhook reuses the §13 ingest: upsert, audit, no duplicates (J2)', async () => {
    const order = {
      externalNumber: 'ECONN-1001',
      orderSourceKey: 'APP',
      orderedAt: new Date().toISOString(),
      customerName: 'Conn Customer',
      value: 120.5,
      externalStatus: 'NEW',
    };
    await request(http)
      .post('/api/v1/integrations/ordering/events')
      .send({ orders: [order] })
      .expect(403); // no token configured yet

    await setSetting('integrations.ordering.inbound_token', ORDERING_TOKEN);
    const first = await request(http)
      .post('/api/v1/integrations/ordering/events')
      .set('X-Integration-Token', ORDERING_TOKEN)
      .send({ orders: [order] })
      .expect(200);
    expect(first.body.accepted).toBe(1);

    await request(http)
      .post('/api/v1/integrations/ordering/events')
      .set('X-Integration-Token', ORDERING_TOKEN)
      .send({ orders: [{ ...order, externalStatus: 'DELIVERED' }] })
      .expect(200);
    const rows = await prisma.onlineOrder.findMany({ where: { externalNumber: 'ECONN-1001' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].externalStatus).toBe('DELIVERED');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'online.orders_ingest', actorEmail: 'connector:ordering' },
    });
    expect(audit).toBeTruthy();
  });

  it('CN-4 DBS availability refresh: gated, queued, applied by the handler (J3)', async () => {
    await request(http)
      .post(`/api/v1/dic/drugs/${drugId}/refresh-availability`)
      .set(auth(managerToken))
      .expect(422); // link not approved yet

    await setSetting('integrations.dbs.enabled', true);
    await setSetting('integrations.dbs.endpoint', `http://127.0.0.1:${stubPort}/dbs`);
    const res = await request(http)
      .post(`/api/v1/dic/drugs/${drugId}/refresh-availability`)
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.status).toBe('PENDING');

    const result = await integrations.processDue();
    expect(result.succeeded).toBeGreaterThanOrEqual(1);

    const drug = await prisma.drug.findUniqueOrThrow({ where: { id: drugId } });
    expect(drug.availability).toEqual({ Riyadh: 55, Jeddah: 8 }); // non-numeric dropped
    const timeline = await prisma.timelineEvent.findFirst({
      where: { entityType: 'drug', entityId: drugId, eventType: 'availability_refreshed' },
    });
    expect(timeline).toBeTruthy();
  });

  it('CN-5 Email channel queues email.send for notified users when enabled (J4)', async () => {
    // Disabled: no op created.
    await notifications.notify({
      userId: agent.id,
      type: 'test.email_off',
      titleAr: 'اختبار',
      titleEn: 'Test',
    });
    expect(
      await prisma.integrationOperation.findFirst({
        where: { integrationKey: 'email', payload: { path: ['type'], equals: 'test.email_off' } },
      }),
    ).toBeNull();

    await setSetting('notifications.email_enabled', true);
    await setSetting('integrations.email.endpoint', `http://127.0.0.1:${stubPort}/email`);
    await notifications.notify({
      userId: agent.id,
      type: 'test.email_on',
      titleAr: 'اختبار البريد',
      titleEn: 'Email test',
    });
    const op = await prisma.integrationOperation.findFirst({
      where: { integrationKey: 'email', payload: { path: ['type'], equals: 'test.email_on' } },
    });
    expect(op).toBeTruthy();
    expect((op!.payload as { to: string }).to).toBe(`agent.${TAG}@milaserv360.test`);
  });

  it('CN-6 branch tickets mail the branch supervisor directly (J4)', async () => {
    await request(http)
      .post('/api/v1/tickets')
      .set(auth(managerToken))
      .send({
        typeKey: 'BRANCH',
        categoryKey: 'PRICING',
        urgencyKey: 'MODERATE',
        customerName: 'عميل',
        customerPhone: '0500000001',
        subject: `Branch pricing issue ${TAG}`,
        description: 'wrong shelf price',
        branchId: branchIds[0],
      })
      .expect(201);

    const op = await prisma.integrationOperation.findFirst({
      where: {
        integrationKey: 'email',
        payload: { path: ['to'], equals: `supervisor.${TAG}@branches.test` },
      },
    });
    expect(op).toBeTruthy();
    expect((op!.payload as { type: string }).type).toBe('ticket.branch_supervisor');
  });

  it('CN-7 SMS rides the complaint lifecycle: created / resolved / CSAT (J5)', async () => {
    await setSetting('integrations.sms.enabled', true);
    await setSetting('integrations.sms.endpoint', `http://127.0.0.1:${stubPort}/sms`);

    const ticket = await request(http)
      .post('/api/v1/tickets')
      .set(auth(managerToken))
      .send({
        typeKey: 'INTERNAL',
        categoryKey: 'COMPLAINT',
        urgencyKey: 'MODERATE',
        customerName: 'عميلة الاختبار',
        customerPhone: '0500000002',
        subject: `SMS lifecycle ${TAG}`,
        description: 'complaint for sms flow',
      })
      .expect(201);
    const ccNumber = ticket.body.customerComplaintNumber as string;

    const smsOps = () =>
      prisma.integrationOperation.findMany({
        where: { integrationKey: 'sms', payload: { path: ['to'], equals: '0500000002' } },
        orderBy: { createdAt: 'asc' },
      });
    let ops = await smsOps();
    expect(ops).toHaveLength(1);
    expect((ops[0].payload as { stage: string }).stage).toBe('created');
    expect((ops[0].payload as { text: string }).text).toContain(ccNumber);
    expect((ops[0].payload as { text: string }).text).toContain('عميلة الاختبار');

    await request(http)
      .post(`/api/v1/tickets/${ticket.body.id}/take`)
      .set(auth(managerToken))
      .expect(201);
    await request(http)
      .post(`/api/v1/tickets/${ticket.body.id}/resolve`)
      .set(auth(managerToken))
      .send({
        summary: 'handled',
        rootCause: 'pricing mismatch',
        actionTaken: 'refund',
        finalSolution: 'customer satisfied',
        resolutionCategoryKey: 'RESOLVED_SERVICE',
        customerInformed: true,
      })
      .expect(201);
    ops = await smsOps();
    expect(ops).toHaveLength(2);
    expect((ops[1].payload as { stage: string }).stage).toBe('resolved');

    await request(http)
      .post(`/api/v1/tickets/${ticket.body.id}/close`)
      .set(auth(managerToken))
      .expect(201);
    ops = await smsOps();
    expect(ops).toHaveLength(3);
    expect((ops[2].payload as { stage: string }).stage).toBe('csat');
    expect((ops[2].payload as { text: string }).text).toContain(ccNumber);
  });

  it('CN-8 Maps enrichment with straight-line fallback (J6)', async () => {
    const base = Number(
      (
        await prisma.setting.findUniqueOrThrow({
          where: {
            key_scopeLevel_scopeId: {
              key: 'branch.delivery.base_minutes',
              scopeLevel: 'SYSTEM',
              scopeId: '',
            },
          },
        })
      ).value,
    );

    await setSetting('integrations.maps.endpoint', `http://127.0.0.1:${stubPort}/maps`);
    const maps = await request(http)
      .get('/api/v1/branches/nearest?lat=30.98&lng=38.05')
      .set(auth(agentToken))
      .expect(200);
    expect(maps.body.distanceSource).toBe('maps');
    const first = maps.body.results[0];
    expect(first.distanceKm).toBe(5); // driving km from the bridge
    expect(first.deliveryEtaMinutes).toBe(Math.round(base + 12)); // base + driving minutes

    // Bridge down → the locator still answers with straight-line math.
    await setSetting('integrations.maps.endpoint', 'http://127.0.0.1:1/maps');
    const fallback = await request(http)
      .get('/api/v1/branches/nearest?lat=30.98&lng=38.05')
      .set(auth(agentToken))
      .expect(200);
    expect(fallback.body.distanceSource).toBe('straight_line');
    expect(fallback.body.results.length).toBeGreaterThanOrEqual(1);
  });

  it('CN-9 connector cards reflect configuration; gated by integration.monitor', async () => {
    await request(http).get('/api/v1/integrations/connectors').set(auth(agentToken)).expect(403);

    const cards = await request(http)
      .get('/api/v1/integrations/connectors')
      .set(auth(ingestToken))
      .expect(200);
    const byKey = new Map(
      (cards.body.connectors as { key: string; configured: boolean; enabled: boolean }[]).map(
        (c) => [c.key, c],
      ),
    );
    expect(byKey.size).toBe(7);
    expect(byKey.get('yeastar')!.configured).toBe(true);
    expect(byKey.get('ordering')!.configured).toBe(true);
    expect(byKey.get('dbs')!.enabled).toBe(true);
    expect(byKey.get('sms')!.enabled).toBe(true);
    expect(byKey.get('email')!.enabled).toBe(true);
  });
});
