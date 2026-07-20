import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Tickets#12345';
const TAG = 'e2e-tkt';

describe('Ticketing engine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let leaderToken: string;
  let agentToken: string;
  let leader: { id: string };
  let agent: { id: string };
  let team: { id: string };
  let branchWithSup: { id: string };
  let branchNoSup: { id: string };

  const base = {
    urgencyKey: 'CRITICAL',
    customerName: 'عميل الاختبار',
    customerPhone: '0501234567',
    subject: 'Ticket lifecycle subject',
    description: 'A ticket created by the e2e lifecycle suite.',
  };

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
        nameAr: `مستخدم`,
        nameEn: `User ${TAG}`,
        departmentId,
        roles: { create: { role: { connect: { key: roleKey } } } },
      },
    });
  }

  async function cleanup() {
    await prisma.ticket.deleteMany({ where: { subject: { contains: 'lifecycle' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { nameEn: { contains: TAG } } });
    await prisma.department.deleteMany({ where: { nameEn: { contains: TAG } } });
    await prisma.branch.deleteMany({ where: { code: { startsWith: 'ETK' } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: `ETK${Date.now() % 100000}`, nameAr: 'إدارة', nameEn: `Dept ${TAG}` },
    });
    team = await prisma.team.create({
      data: { nameAr: 'فريق التذاكر', nameEn: `Team ${TAG}`, departmentId: dept.id },
    });

    await mkUser(`admin.${TAG}@milaserv360.test`, 'SUPER_ADMIN');
    leader = await mkUser(`leader.${TAG}@milaserv360.test`, 'TEAM_LEADER', dept.id);
    agent = await mkUser(`agent.${TAG}@milaserv360.test`, 'AGENT', dept.id);
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: leader.id, role: 'LEADER' },
    });
    await prisma.teamMember.create({
      data: { teamId: team.id, userId: agent.id, role: 'MEMBER' },
    });

    branchWithSup = await prisma.branch.create({
      data: {
        code: 'ETK-B1',
        nameAr: 'فرع به مشرف',
        nameEn: `Branch Sup ${TAG}`,
        supervisorName: 'Branch Supervisor Person',
        supervisorEmail: 'sup@milaserv360.test',
        supervisorPhone: '0500000009',
      },
    });
    branchNoSup = await prisma.branch.create({
      data: { code: 'ETK-B2', nameAr: 'فرع بلا مشرف', nameEn: `Branch NoSup ${TAG}` },
    });

    adminToken = await login(`admin.${TAG}@milaserv360.test`);
    leaderToken = await login(`leader.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('US-1: creates an internal ticket with generated numbers, SLA due dates, audit + timeline', async () => {
    const res = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ ...base, typeKey: 'INTERNAL', categoryKey: 'COMPLAINT' })
      .expect(201);

    expect(res.body.internalNumber).toMatch(/^TKT-\d{4}-\d{6}$/);
    expect(res.body.customerComplaintNumber).toMatch(/^CC-\d{4}-\d{6}$/);
    expect(res.body.status.key).toBe('OPENED');
    expect(res.body.firstResponseDueAt).toBeTruthy(); // CRITICAL policy applied
    expect(res.body.createdBy.id).toBe(agent.id);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ticket.create', entityId: res.body.id },
    });
    expect(audit).toBeTruthy();
    const timeline = await prisma.timelineEvent.findFirst({
      where: { entityType: 'ticket', entityId: res.body.id, eventType: 'created' },
    });
    expect(timeline).toBeTruthy();
  });

  it('rejects invalid catalog values and cross-type categories', async () => {
    await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ ...base, typeKey: 'INTERNAL', categoryKey: 'PRICING' }) // branch-only category
      .expect(400);
    await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ ...base, typeKey: 'INTERNAL', categoryKey: 'COMPLAINT', branchId: 'x' })
      .expect(400); // branchId only for branch tickets
  });

  it('US-2: branch ticket auto-maps the supervisor snapshot and directs the Branch Supervisor team', async () => {
    const res = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...base,
        typeKey: 'BRANCH',
        categoryKey: 'PHARMACIST_BEHAVIOR',
        branchId: branchWithSup.id,
        subject: 'Branch lifecycle with supervisor',
      })
      .expect(201);

    expect(res.body.branchSupervisorSnapshot.name).toBe('Branch Supervisor Person');
    expect(res.body.branchSupervisorSnapshot.capturedAt).toBeTruthy();
    const teamNames = res.body.teams.map((t: { team: { nameEn: string } }) => t.team.nameEn);
    expect(teamNames).toContain('Branch Supervisor');

    // ADR-007: later supervisor change must not rewrite the snapshot.
    await prisma.branch.update({
      where: { id: branchWithSup.id },
      data: { supervisorName: 'Someone Else' },
    });
    const detail = await request(http)
      .get(`/api/v1/tickets/${res.body.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(detail.body.branchSupervisorSnapshot.name).toBe('Branch Supervisor Person');
  });

  it('US-2b: branch without supervisor follows the fallback route and flags data quality', async () => {
    const res = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        ...base,
        typeKey: 'BRANCH',
        categoryKey: 'PRODUCTS',
        branchId: branchNoSup.id,
        subject: 'Branch lifecycle without supervisor',
      })
      .expect(201);

    expect(res.body.branchSupervisorSnapshot).toBeNull();
    const fallbackAudit = await prisma.auditLog.findFirst({
      where: { action: 'ticket.routing_fallback', entityId: branchNoSup.id },
    });
    expect(fallbackAudit).toBeTruthy();
    // lands in the unassigned queue
    const unassigned = await request(http)
      .get('/api/v1/tickets?view=unassigned&pageSize=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(unassigned.body.items.map((t: { id: string }) => t.id)).toContain(res.body.id);
  });

  it('US-3: assignment moves status to Processing, keeps ownership history, notifies assignee', async () => {
    const created = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({
        ...base,
        typeKey: 'INTERNAL',
        categoryKey: 'INQUIRY',
        subject: 'Assignment lifecycle',
        directedTeamIds: [team.id],
      })
      .expect(201);
    const id = created.body.id;

    const assigned = await request(http)
      .post(`/api/v1/tickets/${id}/assign`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ userId: agent.id, reason: 'best fit' })
      .expect(201);
    expect(assigned.body.responsible.id).toBe(agent.id);
    expect(assigned.body.status.key).toBe('PROCESSING');

    // Reassign to leader — history must contain both rows.
    await request(http)
      .post(`/api/v1/tickets/${id}/take`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(201);
    const ownerships = await prisma.ticketOwnership.findMany({
      where: { ticketId: id },
      orderBy: { fromAt: 'asc' },
    });
    expect(ownerships).toHaveLength(2);
    expect(ownerships[0]!.toAt).toBeTruthy(); // closed row
    expect(ownerships[1]!.toAt).toBeNull(); // current owner

    const notification = await prisma.notification.findFirst({
      where: { userId: agent.id, type: 'ticket.assigned' },
    });
    expect(notification).toBeTruthy();
  });

  it('US-4: updates are recorded immutably; WAITING pauses SLA and next update resumes it', async () => {
    const created = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({
        ...base,
        typeKey: 'INTERNAL',
        categoryKey: 'COMPLAINT',
        subject: 'Updates lifecycle',
        directedTeamIds: [team.id],
      })
      .expect(201);
    const id = created.body.id;

    await request(http)
      .post(`/api/v1/tickets/${id}/updates`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ updateTypeKey: 'INVESTIGATION', body: 'Checked the order history.' })
      .expect(201);

    await request(http)
      .post(`/api/v1/tickets/${id}/updates`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ updateTypeKey: 'WAITING', body: 'Waiting for the branch reply.' })
      .expect(201);
    let ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(ticket.slaState).toBe('PAUSED');
    expect(ticket.slaPausedAt).toBeTruthy();
    expect(ticket.firstRespondedAt).toBeTruthy();

    await request(http)
      .post(`/api/v1/tickets/${id}/updates`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ updateTypeKey: 'BRANCH_CONTACT', body: 'Branch replied.' })
      .expect(201);
    ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(ticket.slaState).toBe('ON_TRACK');
    expect(ticket.slaPausedAt).toBeNull();

    const detail = await request(http)
      .get(`/api/v1/tickets/${id}`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(200);
    expect(detail.body.updates).toHaveLength(3);
    expect(detail.body.timeline.length).toBeGreaterThanOrEqual(4);
  });

  it('US-5/US-6 (ADR-005): cannot complete without resolution; full resolve → close → reopen cycle', async () => {
    const created = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({
        ...base,
        typeKey: 'INTERNAL',
        categoryKey: 'COMPLAINT',
        subject: 'Resolution lifecycle',
        directedTeamIds: [team.id],
      })
      .expect(201);
    const id = created.body.id;
    await request(http)
      .post(`/api/v1/tickets/${id}/take`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(201);

    // ADR-005 gate: Completed without a resolution record → 422.
    await request(http)
      .patch(`/api/v1/tickets/${id}/status`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ statusKey: 'COMPLETED' })
      .expect(422);

    // Resolve with all §9.7 mandatory fields → Completed.
    const resolved = await request(http)
      .post(`/api/v1/tickets/${id}/resolve`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({
        summary: 'Customer complaint about pricing resolved',
        rootCause: 'Outdated price tag at the branch',
        actionTaken: 'Branch updated the shelf price and apologized',
        finalSolution: 'Refunded the difference',
        resolutionCategoryKey: 'RESOLVED_BRANCH_ACTION',
        customerInformed: true,
      })
      .expect(201);
    expect(resolved.body.status.key).toBe('COMPLETED');

    const t1 = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(t1.resolvedById).toBe(leader.id);
    expect(['MET', 'BREACHED']).toContain(t1.slaState);

    // Leader lacks ticket.close (spec §8) → 403; admin closes.
    await request(http)
      .post(`/api/v1/tickets/${id}/close`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(403);
    const closed = await request(http)
      .post(`/api/v1/tickets/${id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(closed.body.status.key).toBe('CLOSED');
    const t2 = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(t2.closedById).not.toBe(t2.resolvedById); // ADR-004 separation visible

    // Re-open (admin) → counter increments, appears out of closed view.
    const reopened = await request(http)
      .post(`/api/v1/tickets/${id}/reopen`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'Customer called again' })
      .expect(201);
    expect(reopened.body.status.key).toBe('RE_OPENED');
    expect(reopened.body.reopenCount).toBe(1);

    // Invalid transition from RE_OPENED → CLOSED directly is not in the matrix.
    await request(http)
      .patch(`/api/v1/tickets/${id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ statusKey: 'CLOSED' })
      .expect(409);
  });

  it('A3: customer contact after completion flips status to NEW_RESPONSE automatically', async () => {
    const created = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({
        ...base,
        typeKey: 'INTERNAL',
        categoryKey: 'INQUIRY',
        subject: 'New response lifecycle',
        directedTeamIds: [team.id],
      })
      .expect(201);
    const id = created.body.id;
    await request(http)
      .post(`/api/v1/tickets/${id}/take`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(201);
    await request(http)
      .post(`/api/v1/tickets/${id}/resolve`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({
        summary: 'Answered inquiry',
        rootCause: 'Information request',
        actionTaken: 'Provided the answer',
        finalSolution: 'Shared drug availability info',
        resolutionCategoryKey: 'NOT_AN_ISSUE',
        customerInformed: true,
      })
      .expect(201);

    await request(http)
      .post(`/api/v1/tickets/${id}/updates`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ updateTypeKey: 'CUSTOMER_CONTACT', body: 'Customer replied with a follow-up.' })
      .expect(201);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id },
      include: { status: true },
    });
    expect(ticket.status.key).toBe('NEW_RESPONSE');
    expect(ticket.lastCustomerResponseAt).toBeTruthy();
  });

  it('US-7 scope: agent sees only own tickets; leader sees team tickets; escalate is permission-gated', async () => {
    const agentList = await request(http)
      .get('/api/v1/tickets?pageSize=100')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    for (const t of agentList.body.items) {
      const involved =
        t.createdBy.id === agent.id || (t.responsible && t.responsible.id === agent.id);
      expect(involved).toBe(true);
    }

    const leaderList = await request(http)
      .get('/api/v1/tickets?pageSize=100')
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(200);
    expect(leaderList.body.total).toBeGreaterThan(agentList.body.total);

    // Agent (no ticket.escalate) cannot escalate even a visible ticket.
    const own = agentList.body.items[0];
    await request(http)
      .post(`/api/v1/tickets/${own.id}/escalate`)
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ reason: 'trying to escalate' })
      .expect(403);

    // Leader escalates a ticket directed to their team (in MY_TEAM scope).
    const teamTicket = await prisma.ticket.findFirstOrThrow({
      where: { subject: 'Updates lifecycle' },
    });
    const escalated = await request(http)
      .post(`/api/v1/tickets/${teamTicket.id}/escalate`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .send({ reason: 'SLA at risk' })
      .expect(201);
    expect(escalated.body.status.key).toBe('ESCALATED');

    // Out-of-scope ticket (agent's undirected US-1 ticket) → 404, not a leak.
    const undirected = await prisma.ticket.findFirstOrThrow({
      where: { subject: base.subject, createdById: agent.id },
    });
    await request(http)
      .get(`/api/v1/tickets/${undirected.id}`)
      .set('Authorization', `Bearer ${leaderToken}`)
      .expect(404);
  });

  it('US-7 export: CSV is produced and the export itself is audited (§19.3)', async () => {
    const res = await request(http)
      .get('/api/v1/tickets/export')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text.split('\n')[0]).toContain('internalNumber');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ticket.export' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
  });
});
