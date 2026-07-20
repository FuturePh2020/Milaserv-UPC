import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Perf#12345';
const TAG = 'e2e-perf';

// Fixed, unambiguous anchor dates (spec: metricDate is a plain UTC day).
const DAY = '2026-06-10';
const PREV_DAY = '2026-06-09';

describe('Customer Care performance (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let teamId: string;
  let managerToken: string;
  let agentToken: string;
  let outsiderToken: string;
  let ingestToken: string;
  let agent: { id: string; email: string };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { contains: TAG } } });
    const userIds = users.map((u) => u.id);
    await prisma.ticket.deleteMany({ where: { subject: { contains: TAG } } });
    await prisma.metricValue.deleteMany({ where: { scopeId: { in: userIds } } });
    await prisma.performanceTarget.deleteMany({ where: { scopeId: { in: userIds } } });
    const teams = await prisma.team.findMany({ where: { nameEn: { contains: TAG } } });
    const teamIds = teams.map((t) => t.id);
    await prisma.metricValue.deleteMany({ where: { scopeId: { in: teamIds } } });
    await prisma.performanceTarget.deleteMany({ where: { scopeId: { in: teamIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await prisma.department.deleteMany({ where: { code: 'EPRF' } });
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
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: 'EPRF', nameAr: 'قسم الأداء', nameEn: `Perf Dept ${TAG}` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق الأداء', nameEn: `Perf Team ${TAG}`, departmentId: dept.id },
    });
    teamId = team.id;
    const otherDept = await prisma.department.create({
      data: { code: 'EPRF2', nameAr: 'قسم آخر', nameEn: `Perf Other Dept ${TAG}` },
    });
    const otherTeam = await prisma.team.create({
      data: { nameAr: 'فريق آخر', nameEn: `Perf Other Team ${TAG}`, departmentId: otherDept.id },
    });

    agent = await createUser(`agent.${TAG}@milaserv360.test`, 'AGENT', dept.id, teamId);
    await createUser(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER', dept.id, teamId);
    await createUser(`outsider.${TAG}@milaserv360.test`, 'AGENT', otherDept.id, otherTeam.id);
    await createUser(`ingest.${TAG}@milaserv360.test`, 'INTEGRATION_SUPPORT', dept.id);
    await createUser(`reviewer.${TAG}@milaserv360.test`, 'QUALITY_REVIEWER', dept.id);

    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);
    outsiderToken = await login(`outsider.${TAG}@milaserv360.test`);
    ingestToken = await login(`ingest.${TAG}@milaserv360.test`);
  });

  afterAll(async () => {
    try {
      await cleanup();
      await prisma.department.deleteMany({ where: { code: 'EPRF2' } });
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('PF-1 requires performance.view / performance.ingest', async () => {
    const reviewerToken = await login(`reviewer.${TAG}@milaserv360.test`);
    await request(http)
      .get('/api/v1/performance/dashboard?period=DAILY')
      .set(auth(reviewerToken))
      .expect(403);
    await request(http)
      .post('/api/v1/performance/metrics/ingest')
      .set(auth(agentToken))
      .send({ rows: [{ date: DAY, metricKey: 'inbound_calls', userEmail: agent.email, value: 1 }] })
      .expect(403);
  });

  it('PF-2 metric catalog holds the 16 §12.1 KPIs', async () => {
    const res = await request(http)
      .get('/api/v1/performance/metric-defs')
      .set(auth(agentToken))
      .expect(200);
    const defs = res.body as { key: string; source: string }[];
    // 16 §12.1 KPIs (Yeastar + ticketing SLA); §14.5 telesales KPIs add more.
    expect(defs.filter((d) => d.source !== 'TELESALES')).toHaveLength(16);
    const keys = defs.map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['inbound_calls', 'team_sla', 'agent_sla']));
  });

  it('PF-3 ingestion is an idempotent upsert (§21.1 / D1)', async () => {
    const rows = [
      { date: DAY, metricKey: 'inbound_calls', userEmail: agent.email, value: 50 },
      { date: PREV_DAY, metricKey: 'inbound_calls', userEmail: agent.email, value: 60 },
      { date: DAY, metricKey: 'queue_calls_answered', teamId, value: 120 },
    ];
    const first = await request(http)
      .post('/api/v1/performance/metrics/ingest')
      .set(auth(ingestToken))
      .send({ rows })
      .expect(200);
    expect(first.body).toMatchObject({ accepted: 3, rejected: [] });

    // Re-send the same day with a corrected value: replaces, never duplicates.
    await request(http)
      .post('/api/v1/performance/metrics/ingest')
      .set(auth(ingestToken))
      .send({ rows: [{ ...rows[0], value: 55 }] })
      .expect(200);

    const stored = await prisma.metricValue.findMany({
      where: { scopeId: agent.id, metricKey: 'inbound_calls', metricDate: new Date(DAY) },
    });
    expect(stored).toHaveLength(1);
    expect(Number(stored[0]!.value)).toBe(55);
  });

  it('PF-4 ingestion rejects bad rows per-row with reasons (D7)', async () => {
    const res = await request(http)
      .post('/api/v1/performance/metrics/ingest')
      .set(auth(ingestToken))
      .send({
        rows: [
          { date: DAY, metricKey: 'nope', userEmail: agent.email, value: 1 },
          { date: DAY, metricKey: 'inbound_calls', userEmail: `ghost.${TAG}@x.test`, value: 1 },
          { date: DAY, metricKey: 'agent_sla', userEmail: agent.email, value: 99 },
          { date: DAY, metricKey: 'inbound_calls', value: 1 },
        ],
      })
      .expect(200);
    expect(res.body.accepted).toBe(0);
    expect(res.body.rejected).toHaveLength(4);
  });

  it('PF-5 raw metrics are data-scope filtered (§19.1)', async () => {
    const mine = await request(http)
      .get('/api/v1/performance/metrics?metricKey=inbound_calls')
      .set(auth(agentToken))
      .expect(200);
    expect(mine.body.total).toBeGreaterThanOrEqual(2);

    const foreign = await request(http)
      .get('/api/v1/performance/metrics?metricKey=inbound_calls')
      .set(auth(outsiderToken))
      .expect(200);
    const ids = (foreign.body.items as { scopeId: string }[]).map((v) => v.scopeId);
    expect(ids).not.toContain(agent.id);
  });

  it('PF-6 targets upsert on (scope × metric × period); unknown metric 400', async () => {
    const dto = {
      scopeType: 'USER',
      scopeId: agent.id,
      metricKey: 'inbound_calls',
      period: 'DAILY',
      targetValue: 40,
    };
    await request(http)
      .post('/api/v1/performance/targets')
      .set(auth(managerToken))
      .send(dto)
      .expect(201);
    await request(http)
      .post('/api/v1/performance/targets')
      .set(auth(managerToken))
      .send({ ...dto, targetValue: 44 })
      .expect(201);

    const targets = await prisma.performanceTarget.findMany({
      where: { scopeId: agent.id, metricKey: 'inbound_calls', period: 'DAILY' },
    });
    expect(targets).toHaveLength(1);
    expect(Number(targets[0]!.targetValue)).toBe(44);

    await request(http)
      .post('/api/v1/performance/targets')
      .set(auth(managerToken))
      .send({ ...dto, metricKey: 'nope' })
      .expect(400);

    // Agents can view targets but not set them.
    await request(http)
      .post('/api/v1/performance/targets')
      .set(auth(agentToken))
      .send(dto)
      .expect(403);
  });

  it('PF-7 dashboard: Actual, Target, Achievement %, Trend, color (§12.2)', async () => {
    const res = await request(http)
      .get(`/api/v1/performance/dashboard?period=DAILY&date=${DAY}&metricKey=inbound_calls`)
      .set(auth(managerToken))
      .expect(200);
    const row = (
      res.body.rows as {
        scope: { id: string };
        actual: number;
        target: number;
        achievementPct: number;
        trend: string;
        color: string;
      }[]
    ).find((r) => r.scope.id === agent.id);
    expect(row).toBeTruthy();
    expect(row!.actual).toBe(55);
    expect(row!.target).toBe(44);
    expect(row!.achievementPct).toBe(125);
    expect(row!.trend).toBe('DOWN'); // 55 today vs 60 yesterday
    expect(row!.color).toBe('GREEN');
  });

  it('PF-8 lower-is-better achievement inverts the ratio (D6)', async () => {
    await request(http)
      .post('/api/v1/performance/metrics/ingest')
      .set(auth(ingestToken))
      .send({ rows: [{ date: DAY, metricKey: 'missed_calls', userEmail: agent.email, value: 40 }] })
      .expect(200);
    await request(http)
      .post('/api/v1/performance/targets')
      .set(auth(managerToken))
      .send({
        scopeType: 'USER',
        scopeId: agent.id,
        metricKey: 'missed_calls',
        period: 'DAILY',
        targetValue: 20,
      })
      .expect(201);

    const res = await request(http)
      .get(`/api/v1/performance/dashboard?period=DAILY&date=${DAY}&metricKey=missed_calls`)
      .set(auth(managerToken))
      .expect(200);
    const row = (
      res.body.rows as { scope: { id: string }; achievementPct: number; color: string }[]
    ).find((r) => r.scope.id === agent.id);
    expect(row!.achievementPct).toBe(50); // target 20 / actual 40
    expect(row!.color).toBe('RED');
  });

  it('PF-9 AVG metrics average daily rows over the period (D2)', async () => {
    await request(http)
      .post('/api/v1/performance/metrics/ingest')
      .set(auth(ingestToken))
      .send({
        rows: [
          { date: DAY, metricKey: 'avg_wait_time', userEmail: agent.email, value: 30 },
          { date: PREV_DAY, metricKey: 'avg_wait_time', userEmail: agent.email, value: 60 },
        ],
      })
      .expect(200);
    const res = await request(http)
      .get(`/api/v1/performance/dashboard?period=MONTHLY&date=${DAY}&metricKey=avg_wait_time`)
      .set(auth(managerToken))
      .expect(200);
    const row = (res.body.rows as { scope: { id: string }; actual: number; color: string }[]).find(
      (r) => r.scope.id === agent.id,
    );
    expect(row!.actual).toBe(45);
    expect(row!.color).toBe('GRAY'); // no MONTHLY target → informational (D4)
  });

  it('PF-10 agent_sla / team_sla come from resolved tickets (D3)', async () => {
    const created = await request(http)
      .post('/api/v1/tickets')
      .set(auth(managerToken))
      .send({
        typeKey: 'INTERNAL',
        categoryKey: 'COMPLAINT',
        urgencyKey: 'LOW',
        customerName: 'عميل',
        customerPhone: '0500000001',
        subject: `${TAG} sla source ticket`,
        description: 'performance sla source ticket',
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
        summary: 'resolved within SLA',
        rootCause: 'test',
        actionTaken: 'test action',
        finalSolution: 'final solution',
        resolutionCategoryKey: 'RESOLVED_SERVICE',
        customerInformed: true,
      })
      .expect(201);

    const today = new Date().toISOString().slice(0, 10);
    const res = await request(http)
      .get(`/api/v1/performance/dashboard?period=DAILY&date=${today}&metricKey=agent_sla`)
      .set(auth(managerToken))
      .expect(200);
    const manager = await prisma.user.findFirstOrThrow({
      where: { email: `manager.${TAG}@milaserv360.test` },
    });
    const row = (res.body.rows as { scope: { id: string }; actual: number }[]).find(
      (r) => r.scope.id === manager.id,
    );
    expect(row!.actual).toBe(100); // 1/1 resolved without breach
  });

  it('PF-11 dashboard is scope-filtered; unknown metric is 404', async () => {
    const res = await request(http)
      .get(`/api/v1/performance/dashboard?period=DAILY&date=${DAY}&metricKey=inbound_calls`)
      .set(auth(outsiderToken))
      .expect(200);
    const ids = (res.body.rows as { scope: { id: string } }[]).map((r) => r.scope.id);
    expect(ids).not.toContain(agent.id);

    await request(http)
      .get('/api/v1/performance/dashboard?period=DAILY&metricKey=nope')
      .set(auth(managerToken))
      .expect(404);
  });

  it('PF-12 targets delete', async () => {
    const target = await prisma.performanceTarget.findFirstOrThrow({
      where: { scopeId: agent.id, metricKey: 'missed_calls' },
    });
    await request(http)
      .delete(`/api/v1/performance/targets/${target.id}`)
      .set(auth(managerToken))
      .expect(204);
    const gone = await prisma.performanceTarget.findUnique({ where: { id: target.id } });
    expect(gone).toBeNull();
  });
});
