import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { SlaSweeperService } from '../src/modules/tickets/sla-sweeper.service';

const prisma = new PrismaClient();
const PASSWORD = 'SlaTest#12345';
const TAG = 'e2e-sla';

describe('SLA engine (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sweeper: SlaSweeperService;
  let adminToken: string;
  let admin: { id: string };

  async function cleanup() {
    await prisma.ticket.deleteMany({ where: { subject: { contains: TAG } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    sweeper = app.get(SlaSweeperService);
    await cleanup();

    admin = await prisma.user.create({
      data: {
        email: `admin.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مدير',
        nameEn: `Admin ${TAG}`,
        roles: { create: { role: { connect: { key: 'SUPER_ADMIN' } } } },
      },
    });
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: `admin.${TAG}@milaserv360.test`, password: PASSWORD })
      .expect(200);
    adminToken = res.body.accessToken;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  async function createTicket(subject: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        typeKey: 'INTERNAL',
        categoryKey: 'COMPLAINT',
        urgencyKey: 'CRITICAL',
        customerName: 'عميل',
        customerPhone: '0500000000',
        subject,
        description: 'SLA test ticket description',
      })
      .expect(201);
    // Take responsibility so notifications have a target.
    await request(http)
      .post(`/api/v1/tickets/${res.body.id}/take`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    return res.body.id;
  }

  it('flips ON_TRACK → WARNING at the policy threshold and notifies', async () => {
    const id = await createTicket(`${TAG} warning case`);
    // Move due date so we are inside the warning window but not breached:
    // CRITICAL resolution = 240m, threshold 80% → warning during the last 48m.
    await prisma.ticket.update({
      where: { id },
      data: { resolutionDueAt: new Date(Date.now() + 30 * 60_000) },
    });

    const result = await sweeper.sweep();
    expect(result.warned).toBeGreaterThanOrEqual(1);

    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(ticket.slaState).toBe('WARNING');

    const event = await prisma.timelineEvent.findFirst({
      where: { entityType: 'ticket', entityId: id, eventType: 'sla_warning' },
    });
    expect(event).toBeTruthy();
    const notification = await prisma.notification.findFirst({
      where: { userId: admin.id, type: 'ticket.sla_warning' },
    });
    expect(notification).toBeTruthy();
  });

  it('flips to BREACHED past due, auto-escalates per matrix, and notifies', async () => {
    const id = await createTicket(`${TAG} breach case`);
    await prisma.ticket.update({
      where: { id },
      data: { resolutionDueAt: new Date(Date.now() - 60_000) },
    });

    const result = await sweeper.sweep();
    expect(result.breached).toBeGreaterThanOrEqual(1);

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id },
      include: { status: true },
    });
    expect(ticket.slaState).toBe('BREACHED');
    expect(ticket.status.key).toBe('ESCALATED'); // PROCESSING → ESCALATED exists in matrix

    const event = await prisma.timelineEvent.findFirst({
      where: { entityType: 'ticket', entityId: id, eventType: 'sla_breached' },
    });
    expect(event).toBeTruthy();
    const notification = await prisma.notification.findFirst({
      where: { userId: admin.id, type: 'ticket.sla_breached' },
    });
    expect(notification).toBeTruthy();
  });

  it('notifies first-response breach exactly once', async () => {
    const id = await createTicket(`${TAG} first response case`);
    await prisma.ticket.update({
      where: { id },
      data: { firstResponseDueAt: new Date(Date.now() - 60_000), firstRespondedAt: null },
    });

    await sweeper.sweep();
    await sweeper.sweep(); // second run must not duplicate

    const events = await prisma.timelineEvent.findMany({
      where: { entityType: 'ticket', entityId: id, eventType: 'sla_first_response_breach' },
    });
    expect(events).toHaveLength(1);
  });

  it('paused tickets are ignored by the sweep', async () => {
    const id = await createTicket(`${TAG} paused case`);
    await request(http)
      .post(`/api/v1/tickets/${id}/updates`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ updateTypeKey: 'WAITING', body: 'Waiting on external party.' })
      .expect(201);
    await prisma.ticket.update({
      where: { id },
      data: { resolutionDueAt: new Date(Date.now() - 60_000) },
    });

    await sweeper.sweep();
    const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id } });
    expect(ticket.slaState).toBe('PAUSED'); // untouched
  });
});
