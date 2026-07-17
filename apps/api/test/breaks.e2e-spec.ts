import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { BreaksSweeperService } from '../src/modules/breaks/breaks-sweeper.service';

const prisma = new PrismaClient();
const PASSWORD = 'Break#12345';
const TAG = 'e2e-breaks';

describe('Break Tracker (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let sweeper: BreaksSweeperService;
  let teamId: string;
  let agent1Token: string;
  let agent2Token: string;
  let outsiderToken: string;
  let agent1: { id: string };
  let lead: { id: string };

  async function cleanup() {
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    const teams = await prisma.team.findMany({ where: { nameEn: { contains: TAG } } });
    await prisma.setting.deleteMany({ where: { scopeId: { in: teams.map((t) => t.id) } } });
    await prisma.team.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
    await prisma.department.deleteMany({ where: { code: { contains: 'EBRK' } } });
  }

  async function createUser(email: string, roleKey: string, team?: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: `User ${email.split('@')[0]}`,
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

  /** TEAM-scope setting override (ADR-008) applied straight to the table. */
  async function overrideTeamSetting(key: string, value: number) {
    const system = await prisma.setting.findFirstOrThrow({
      where: { key, scopeLevel: 'SYSTEM' },
    });
    await prisma.setting.upsert({
      where: { key_scopeLevel_scopeId: { key, scopeLevel: 'TEAM', scopeId: teamId } },
      update: { value },
      create: {
        key,
        category: system.category,
        valueType: system.valueType,
        value,
        scopeLevel: 'TEAM',
        scopeId: teamId,
        labelAr: system.labelAr,
        labelEn: system.labelEn,
      },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    sweeper = app.get(BreaksSweeperService);
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: 'EBRK', nameAr: 'قسم البريك', nameEn: `Breaks Dept ${TAG}` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق البريك', nameEn: `Breaks Team ${TAG}`, departmentId: dept.id },
    });
    teamId = team.id;
    const otherTeam = await prisma.team.create({
      data: { nameAr: 'فريق آخر', nameEn: `Other Team ${TAG}`, departmentId: dept.id },
    });

    // SUPERVISOR: break.track (self) + break.viewTeam MY_TEAM per spec §8.
    agent1 = await createUser(`agent1.${TAG}@milaserv360.test`, 'SUPERVISOR', teamId);
    await createUser(`agent2.${TAG}@milaserv360.test`, 'AGENT', teamId);
    await createUser(`outsider.${TAG}@milaserv360.test`, 'SUPERVISOR', otherTeam.id);
    lead = await createUser(`lead.${TAG}@milaserv360.test`, 'TEAM_LEADER');
    await prisma.teamMember.create({ data: { teamId, userId: lead.id, role: 'LEADER' } });

    agent1Token = await login(`agent1.${TAG}@milaserv360.test`);
    agent2Token = await login(`agent2.${TAG}@milaserv360.test`);
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('BR-1 requires break.track / break.viewTeam permissions', async () => {
    const noRole = await createUser(`norole.${TAG}@milaserv360.test`, 'INTEGRATION_SUPPORT');
    const token = await login(`norole.${TAG}@milaserv360.test`);
    await request(http).post('/api/v1/breaks/session/start').set(auth(token)).expect(403);
    await request(http).get('/api/v1/breaks/live').set(auth(token)).expect(403);
    await prisma.user.delete({ where: { id: noRole.id } });
  });

  it('BR-2 /breaks/me without a session returns allowance + config', async () => {
    const res = await request(http).get('/api/v1/breaks/me').set(auth(agent1Token)).expect(200);
    expect(res.body.session).toBeNull();
    expect(res.body.breakAllowance.allowanceMinutes).toBeGreaterThan(0);
    expect(res.body.config.heartbeatIntervalSeconds).toBeGreaterThan(0);
  });

  it('BR-3 start session opens a WORK period; a second start is 409', async () => {
    const res = await request(http)
      .post('/api/v1/breaks/session/start')
      .set(auth(agent1Token))
      .expect(201);
    expect(res.body.session.currentPeriod.type).toBe('WORK');
    expect(res.body.session.teamId).toBe(teamId);

    await request(http).post('/api/v1/breaks/session/start').set(auth(agent1Token)).expect(409);

    const timeline = await prisma.timelineEvent.findFirst({
      where: { entityType: 'work_session', entityId: res.body.session.id },
    });
    expect(timeline?.eventType).toBe('session_started');
  });

  it('BR-4 inactivity past the threshold flips WORK → IDLE backdated to inactivity start (§11.2)', async () => {
    await overrideTeamSetting('break.idle_threshold_seconds', 60);

    // Simulate a session running for 3 minutes with the last input 2 minutes
    // ago (clients cannot backdate activity — the clamp in heartbeat()
    // rejects timestamps older than the stored one, so we age the rows).
    const session = await prisma.workSession.findFirstOrThrow({
      where: { userId: agent1.id, status: 'ACTIVE' },
    });
    await prisma.workSession.update({
      where: { id: session.id },
      data: {
        startedAt: new Date(Date.now() - 180_000),
        lastActivityAt: new Date(Date.now() - 120_000),
      },
    });
    await prisma.workPeriod.updateMany({
      where: { sessionId: session.id, endedAt: null },
      data: { startedAt: new Date(Date.now() - 180_000) },
    });
    const res = await request(http)
      .post('/api/v1/breaks/heartbeat')
      .set(auth(agent1Token))
      .send({})
      .expect(200);

    expect(res.body.session.currentPeriod.type).toBe('IDLE');
    // Backdated: idle time already ≈ 2 minutes at detection.
    expect(res.body.session.idleSeconds).toBeGreaterThanOrEqual(100);

    const notif = await prisma.notification.findFirst({
      where: { userId: agent1.id, type: 'break.idle_started' },
    });
    expect(notif).toBeTruthy();
  });

  it('BR-5 fresh activity flips IDLE → WORK and rolls up idle seconds', async () => {
    const res = await request(http)
      .post('/api/v1/breaks/heartbeat')
      .set(auth(agent1Token))
      .send({ lastActivityAt: new Date().toISOString() })
      .expect(200);
    expect(res.body.session.currentPeriod.type).toBe('WORK');
    expect(res.body.session.idleSeconds).toBeGreaterThanOrEqual(100);
  });

  it('BR-6 break start/end records the period; team concurrency cap enforced (§11.3)', async () => {
    await overrideTeamSetting('break.max_concurrent_per_team', 1);

    const res = await request(http)
      .post('/api/v1/breaks/break/start')
      .set(auth(agent1Token))
      .expect(200);
    expect(res.body.session.currentPeriod.type).toBe('BREAK');

    // Teammate hits the cap while agent1 is on break.
    await request(http).post('/api/v1/breaks/session/start').set(auth(agent2Token)).expect(201);
    await request(http).post('/api/v1/breaks/break/start').set(auth(agent2Token)).expect(409);
  });

  it('BR-7 live view shows ON_BREAK / AVAILABLE, scoped to my team (§11.3)', async () => {
    const res = await request(http).get('/api/v1/breaks/live').set(auth(agent1Token)).expect(200);
    const byName = new Map(
      (res.body.members as { user: { id: string }; state: string }[]).map((m) => [
        m.user.id,
        m.state,
      ]),
    );
    expect(byName.get(agent1.id)).toBe('ON_BREAK');
    const agent2 = await prisma.user.findFirstOrThrow({
      where: { email: `agent2.${TAG}@milaserv360.test` },
    });
    expect(byName.get(agent2.id)).toBe('AVAILABLE');

    // Outsider (other team, MY_TEAM scope) must not see agent1.
    const out = await request(http).get('/api/v1/breaks/live').set(auth(outsiderToken)).expect(200);
    const outIds = (out.body.members as { user: { id: string } }[]).map((m) => m.user.id);
    expect(outIds).not.toContain(agent1.id);
  });

  it('BR-8 ending a break past the allowance notifies employee + supervisor (§11.3)', async () => {
    // -1 makes any usage (even a seconds-long test break) an overage,
    // independent of how close the run is to the day boundary (C6).
    await overrideTeamSetting('break.daily_allowance_minutes', -1);

    const res = await request(http)
      .post('/api/v1/breaks/break/end')
      .set(auth(agent1Token))
      .expect(200);
    expect(res.body.session.currentPeriod.type).toBe('WORK');
    expect(res.body.breakAllowance.remainingMinutes).toBeLessThan(0);

    const mine = await prisma.notification.findFirst({
      where: { userId: agent1.id, type: 'break.overage' },
    });
    const supervisor = await prisma.notification.findFirst({
      where: { userId: lead.id, type: 'break.overage' },
    });
    expect(mine).toBeTruthy();
    expect(supervisor).toBeTruthy();
  });

  it('BR-9 session history lists periods, scope-filtered', async () => {
    const res = await request(http)
      .get('/api/v1/breaks/sessions')
      .set(auth(agent1Token))
      .expect(200);
    const mine = (res.body.items as { user: { id: string }; periods: unknown[] }[]).find(
      (s) => s.user.id === agent1.id,
    );
    expect(mine).toBeTruthy();
    expect(mine!.periods.length).toBeGreaterThanOrEqual(4); // WORK, IDLE, WORK, BREAK, …

    const out = await request(http)
      .get('/api/v1/breaks/sessions')
      .set(auth(outsiderToken))
      .expect(200);
    const ids = (out.body.items as { user: { id: string } }[]).map((s) => s.user.id);
    expect(ids).not.toContain(agent1.id);
  });

  it('BR-10 end session finalizes counters and closes the open period (§11.1)', async () => {
    const res = await request(http)
      .post('/api/v1/breaks/session/end')
      .set(auth(agent1Token))
      .expect(200);
    expect(res.body.endReason).toBe('MANUAL');
    expect(res.body.idleSeconds).toBeGreaterThanOrEqual(100);
    expect(res.body.breakSeconds).toBeGreaterThanOrEqual(0);

    const open = await prisma.workPeriod.findFirst({
      where: { session: { id: res.body.id }, endedAt: null },
    });
    expect(open).toBeNull();

    const me = await request(http).get('/api/v1/breaks/me').set(auth(agent1Token)).expect(200);
    expect(me.body.session).toBeNull();
  });

  it('BR-11 sweeper flips silent WORK sessions to IDLE server-side (§11.2)', async () => {
    await request(http).post('/api/v1/breaks/session/start').set(auth(agent1Token)).expect(201);
    const session = await prisma.workSession.findFirstOrThrow({
      where: { userId: agent1.id, status: 'ACTIVE' },
    });
    await prisma.workSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date(Date.now() - 5 * 60_000) },
    });

    const result = await sweeper.sweep();
    expect(result.idled).toBeGreaterThanOrEqual(1);
    const open = await prisma.workPeriod.findFirstOrThrow({
      where: { sessionId: session.id, endedAt: null },
    });
    expect(open.type).toBe('IDLE');
  });

  it('BR-12 sweeper auto-ends abandoned sessions (spec C4)', async () => {
    const session = await prisma.workSession.findFirstOrThrow({
      where: { userId: agent1.id, status: 'ACTIVE' },
    });
    await prisma.workSession.update({
      where: { id: session.id },
      data: { lastHeartbeatAt: new Date(Date.now() - 13 * 3600_000) },
    });

    const result = await sweeper.sweep();
    expect(result.autoEnded).toBeGreaterThanOrEqual(1);
    const ended = await prisma.workSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(ended.status).toBe('ENDED');
    expect(ended.endReason).toBe('AUTO');
  });
});
