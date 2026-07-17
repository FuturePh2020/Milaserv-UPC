import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Crm#12345';
const TAG = 'e2e-crm';

describe('CRM, Leads & Telesales (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let teamId: string;
  let managerToken: string;
  let agentToken: string;
  let outsiderToken: string;
  let agent: { id: string };
  let batchId: string;
  let leadId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { contains: TAG } } });
    await prisma.lead.deleteMany({ where: { leadSource: { contains: TAG } } });
    await prisma.telesalesOrder.deleteMany({
      where: { createdById: { in: users.map((u) => u.id) } },
    });
    await prisma.leadBatch.deleteMany({ where: { fileName: { contains: TAG } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    const teams = await prisma.team.findMany({ where: { nameEn: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
    await prisma.department.deleteMany({ where: { code: { in: ['ECRM', 'ECRM2'] } } });
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

  async function startShift(token: string) {
    await request(http).post('/api/v1/breaks/session/start').set(auth(token)).expect(201);
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: 'ECRM', nameAr: 'قسم التيليسيلز', nameEn: `CRM Dept ${TAG}` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق التيليسيلز', nameEn: `CRM Team ${TAG}`, departmentId: dept.id },
    });
    teamId = team.id;
    const otherDept = await prisma.department.create({
      data: { code: 'ECRM2', nameAr: 'قسم آخر', nameEn: `CRM Other Dept ${TAG}` },
    });
    const otherTeam = await prisma.team.create({
      data: { nameAr: 'فريق آخر', nameEn: `CRM Other Team ${TAG}`, departmentId: otherDept.id },
    });

    agent = await createUser(`agent.${TAG}@milaserv360.test`, 'AGENT', dept.id, teamId);
    await createUser(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER', dept.id, teamId);
    await createUser(`outsider.${TAG}@milaserv360.test`, 'AGENT', otherDept.id, otherTeam.id);

    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);
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

  it('CR-1 upload requires crm.upload; agents get 403', async () => {
    await request(http)
      .post('/api/v1/crm/leads/preview')
      .set(auth(agentToken))
      .send({ fileName: 'x.xlsx', leadSource: TAG, rows: [{ name: 'a', phone: '0501111111' }] })
      .expect(403);
  });

  it('CR-2 preview validates rows and flags duplicates without writing (§14.1)', async () => {
    const res = await request(http)
      .post('/api/v1/crm/leads/preview')
      .set(auth(managerToken))
      .send({
        fileName: `${TAG}.xlsx`,
        leadSource: `src-${TAG}`,
        rows: [
          { name: 'Customer A', phone: '0501111111' },
          { name: 'Customer B', phone: '050 111-1111' }, // same digits → file dupe
          { name: '', phone: '0502222222' }, // invalid: no name
          { name: 'Customer C', phone: '123' }, // invalid: short phone
          { name: 'Customer D', phone: '0503333333' },
        ],
      })
      .expect(200);
    expect(res.body.counts).toEqual({ valid: 2, invalid: 2, duplicates: 1 });
    expect(await prisma.lead.count({ where: { leadSource: `src-${TAG}` } })).toBe(0);
  });

  it('CR-3 import creates the batch, stamps source/partner/campaign, skips dupes (§14.1)', async () => {
    const res = await request(http)
      .post('/api/v1/crm/leads/import')
      .set(auth(managerToken))
      .send({
        fileName: `${TAG}.xlsx`,
        leadSource: `src-${TAG}`,
        partnerName: 'Partner X',
        campaign: 'Ramadan',
        rows: [
          { name: 'Customer A', phone: '0501111111', city: 'Riyadh' },
          { name: 'Customer A copy', phone: '+966 50 111 1111' },
          { name: 'Customer D', phone: '0503333333' },
        ],
      })
      .expect(201);
    batchId = res.body.batchId;
    expect(res.body.imported).toBe(2);
    expect(res.body.skipped).toHaveLength(1);

    const leads = await prisma.lead.findMany({ where: { batchId } });
    expect(leads).toHaveLength(2);
    expect(leads.every((l) => l.leadSource === `src-${TAG}` && l.partnerName === 'Partner X')).toBe(
      true,
    );

    // Re-importing the same phones now hits DUPLICATE_EXISTING.
    const again = await request(http)
      .post('/api/v1/crm/leads/import')
      .set(auth(managerToken))
      .send({
        fileName: `${TAG}-2.xlsx`,
        leadSource: `src-${TAG}`,
        rows: [{ name: 'Customer A', phone: '0501111111' }],
      })
      .expect(201);
    expect(again.body.imported).toBe(0);
    expect(again.body.skipped[0].status).toBe('DUPLICATE_EXISTING');
  });

  it('CR-4 next-lead requires an ACTIVE shift session (§14.1)', async () => {
    const res = await request(http).post('/api/v1/crm/leads/next').set(auth(agentToken));
    expect(res.status).toBe(422);
    expect(res.body.message).toContain('session');
  });

  it('CR-5 one-by-one distribution: FIFO claim, same lead until dispositioned', async () => {
    await startShift(agentToken);
    const first = await request(http)
      .post('/api/v1/crm/leads/next')
      .set(auth(agentToken))
      .expect(200);
    expect(first.body.phone).toBe('0501111111'); // oldest first
    leadId = first.body.id;

    // Pulling again returns the same lead — no hoarding.
    const againRes = await request(http)
      .post('/api/v1/crm/leads/next')
      .set(auth(agentToken))
      .expect(200);
    expect(againRes.body.id).toBe(leadId);
  });

  it('CR-6 reschedule disposition demands rescheduledAt and keeps the lead open (§14.1/§14.3)', async () => {
    await request(http)
      .post(`/api/v1/crm/leads/${leadId}/call`)
      .set(auth(agentToken))
      .send({ callStatusKey: 'NO_ANSWER', dispositionKey: 'CALL_BACK_LATER', durationSeconds: 20 })
      .expect(422);

    const future = new Date(Date.now() + 3600_000).toISOString();
    await request(http)
      .post(`/api/v1/crm/leads/${leadId}/call`)
      .set(auth(agentToken))
      .send({
        callStatusKey: 'NO_ANSWER',
        dispositionKey: 'CALL_BACK_LATER',
        durationSeconds: 20,
        rescheduledAt: future,
      })
      .expect(201);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe('ASSIGNED');
    expect(lead.rescheduledAt).not.toBeNull();

    // Rescheduled to the future → /next moves on to the following NEW lead.
    const next = await request(http)
      .post('/api/v1/crm/leads/next')
      .set(auth(agentToken))
      .expect(200);
    expect(next.body.id).not.toBe(leadId);
  });

  it('CR-7 due reschedules come back before NEW leads', async () => {
    // Close the currently held lead so the agent is free.
    const current = await prisma.lead.findFirstOrThrow({
      where: { assignedToId: agent.id, status: 'ASSIGNED', rescheduledAt: null },
    });
    await request(http)
      .post(`/api/v1/crm/leads/${current.id}/call`)
      .set(auth(agentToken))
      .send({ callStatusKey: 'ANSWERED', dispositionKey: 'NOT_INTERESTED', durationSeconds: 30 })
      .expect(201);
    const closed = await prisma.lead.findUniqueOrThrow({ where: { id: current.id } });
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedDispositionKey).toBe('NOT_INTERESTED');

    // Make the rescheduled lead due now.
    await prisma.lead.update({
      where: { id: leadId },
      data: { rescheduledAt: new Date(Date.now() - 1000) },
    });
    const next = await request(http)
      .post('/api/v1/crm/leads/next')
      .set(auth(agentToken))
      .expect(200);
    expect(next.body.id).toBe(leadId);
  });

  it('CR-8 Order Created requires order payload, creates a numbered order, closes the lead (§14.3/§14.4)', async () => {
    await request(http)
      .post(`/api/v1/crm/leads/${leadId}/call`)
      .set(auth(agentToken))
      .send({ callStatusKey: 'ANSWERED', dispositionKey: 'ORDER_CREATED', durationSeconds: 240 })
      .expect(422);

    const res = await request(http)
      .post(`/api/v1/crm/leads/${leadId}/call`)
      .set(auth(agentToken))
      .send({
        callStatusKey: 'ANSWERED',
        dispositionKey: 'ORDER_CREATED',
        durationSeconds: 240,
        order: { orderTypeKey: 'CASH', value: 350.5 },
      })
      .expect(201);
    expect(res.body.order.number).toMatch(/^ORD-\d{4}-\d{6}$/);

    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.status).toBe('CLOSED');
    expect(lead.closedDispositionKey).toBe('ORDER_CREATED');

    const order = await prisma.telesalesOrder.findUniqueOrThrow({
      where: { id: res.body.order.id },
    });
    expect(order.status).toBe('OPEN');
    expect(Number(order.value)).toBe(350.5);
    // Order snapshot carries the lead's customer identity.
    expect(order.customerPhone).toBe('0501111111');
  });

  it('CR-9 order completion; already-final orders are 422', async () => {
    const order = await prisma.telesalesOrder.findFirstOrThrow({
      where: { createdById: agent.id },
    });
    await request(http)
      .patch(`/api/v1/crm/orders/${order.id}/status`)
      .set(auth(agentToken))
      .send({ status: 'COMPLETED' })
      .expect(200);
    await request(http)
      .patch(`/api/v1/crm/orders/${order.id}/status`)
      .set(auth(agentToken))
      .send({ status: 'CANCELLED' })
      .expect(422);
  });

  it('CR-10 leads and orders are scope-filtered (§19.1)', async () => {
    const mine = await request(http).get('/api/v1/crm/leads').set(auth(agentToken)).expect(200);
    expect(mine.body.total).toBeGreaterThanOrEqual(2);

    const foreignLeads = await request(http)
      .get('/api/v1/crm/leads?status=CLOSED')
      .set(auth(outsiderToken))
      .expect(200);
    const ids = (foreignLeads.body.items as { id: string }[]).map((l) => l.id);
    expect(ids).not.toContain(leadId);

    const foreignOrders = await request(http)
      .get('/api/v1/crm/orders')
      .set(auth(outsiderToken))
      .expect(200);
    expect(foreignOrders.body.total).toBe(0);
  });

  it('CR-11 telesales KPIs appear in the §12 performance dashboard (§14.5)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const get = async (metricKey: string) => {
      const res = await request(http)
        .get(`/api/v1/performance/dashboard?period=DAILY&date=${today}&metricKey=${metricKey}`)
        .set(auth(managerToken))
        .expect(200);
      return (
        res.body.rows as { scopeType: string; scope: { id: string }; actual: number | null }[]
      ).find((r) => r.scopeType === 'USER' && r.scope.id === agent.id);
    };

    expect((await get('ts_calls'))!.actual).toBe(3); // CBL + NOT_INTERESTED + ORDER_CREATED
    expect((await get('ts_leads_called'))!.actual).toBe(2); // two distinct leads
    expect((await get('ts_orders_created'))!.actual).toBe(1);
    expect((await get('ts_completed_orders'))!.actual).toBe(1);
    expect((await get('ts_open_orders'))!.actual).toBe(0);
    expect((await get('ts_sales_value'))!.actual).toBe(350.5);
    expect((await get('ts_talk_time'))!.actual).toBe(290); // 20 + 30 + 240
    expect((await get('ts_conversion_rate'))!.actual).toBe(50); // 1 order / 2 leads

    // Team row aggregates the agent.
    const teamRes = await request(http)
      .get(`/api/v1/performance/dashboard?period=DAILY&date=${today}&metricKey=ts_calls`)
      .set(auth(managerToken))
      .expect(200);
    const teamRow = (
      teamRes.body.rows as { scopeType: string; scope: { id: string }; actual: number }[]
    ).find((r) => r.scopeType === 'TEAM' && r.scope.id === teamId);
    expect(teamRow!.actual).toBeGreaterThanOrEqual(3);
  });

  it('CR-12 monthly targets work for telesales KPIs (§14.5 Monthly/Annual Targets)', async () => {
    await request(http)
      .post('/api/v1/performance/targets')
      .set(auth(managerToken))
      .send({
        scopeType: 'USER',
        scopeId: agent.id,
        metricKey: 'ts_orders_created',
        period: 'MONTHLY',
        targetValue: 2,
      })
      .expect(201);

    const today = new Date().toISOString().slice(0, 10);
    const res = await request(http)
      .get(`/api/v1/performance/dashboard?period=MONTHLY&date=${today}&metricKey=ts_orders_created`)
      .set(auth(managerToken))
      .expect(200);
    const row = (
      res.body.rows as {
        scope: { id: string };
        actual: number;
        target: number;
        achievementPct: number;
        color: string;
      }[]
    ).find((r) => r.scope.id === agent.id);
    expect(row!.actual).toBe(1);
    expect(row!.target).toBe(2);
    expect(row!.achievementPct).toBe(50);
    expect(row!.color).toBe('RED');

    await prisma.performanceTarget.deleteMany({
      where: { scopeId: agent.id, metricKey: 'ts_orders_created' },
    });
  });
});
