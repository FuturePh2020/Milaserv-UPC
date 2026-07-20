import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'DicAlias#12345';
const TAG = 'e2e-dic-alias';

/**
 * CR-002 Phase 4 Step 4 — DrugAlias and DrugAlternativeLink
 * propose/approve/reject workflows (design doc §6/§10/§17). Distinct
 * suite from dic-search-extended.e2e-spec.ts (which only reads these
 * relations) and dic-reference.e2e-spec.ts (controlled catalogs).
 */
describe('DIC Alias & Alternative-Link Workflows (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let managerToken: string;
  let agentToken: string;
  let drugAId: string;
  let drugBId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9EDICALIAS' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    const mk = async (email: string, role: string) =>
      prisma.user.create({
        data: {
          email,
          passwordHash: await argon2.hash(PASSWORD),
          nameAr: 'مستخدم',
          nameEn: `User ${email.split('@')[0]}`,
          roles: { create: { role: { connect: { key: role } } } },
        },
      });
    await mk(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER');
    await mk(`agent.${TAG}@milaserv360.test`, 'AGENT');

    const login = async (email: string) =>
      (
        await request(http)
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);

    const drugA = await prisma.drug.create({
      data: { materialNo: '9EDICALIAS1', nameEn: 'AliasoDrug A' },
    });
    drugAId = drugA.id;
    const drugB = await prisma.drug.create({
      data: { materialNo: '9EDICALIAS2', nameEn: 'AliasoDrug B' },
    });
    drugBId = drugB.id;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  // ── Aliases ──────────────────────────────────────────────────────────

  it('DA-1 dic.edit holders can propose an alias, unapproved by default', async () => {
    const res = await request(http)
      .post(`/api/v1/dic/drugs/${drugAId}/aliases`)
      .set(auth(managerToken))
      .send({ alias: 'Aliaso Drug', language: 'en', aliasType: 'COMMON_MISSPELLING' })
      .expect(201);
    expect(res.body.approved).toBe(false);
    expect(res.body.duplicateOf).toEqual([]);
  });

  it('DA-2 proposing the same alias twice on the same drug is rejected', async () => {
    await request(http)
      .post(`/api/v1/dic/drugs/${drugAId}/aliases`)
      .set(auth(managerToken))
      .send({ alias: 'Aliaso Drug', language: 'en', aliasType: 'COMMON_MISSPELLING' })
      .expect(400);
  });

  it('DA-3 dic.view-only users cannot propose an alias', async () => {
    await request(http)
      .post(`/api/v1/dic/drugs/${drugAId}/aliases`)
      .set(auth(agentToken))
      .send({ alias: 'Something Else', language: 'en', aliasType: 'COMMON_MISSPELLING' })
      .expect(403);
  });

  it('DA-4 pending aliases are listed, and dic.approve_alias can approve one', async () => {
    const pending = await request(http)
      .get('/api/v1/dic/aliases/pending')
      .set(auth(managerToken))
      .expect(200);
    const target = pending.body.find((a: { alias: string }) => a.alias === 'Aliaso Drug');
    expect(target).toBeDefined();

    await request(http)
      .post(`/api/v1/dic/aliases/${target.id}/decide`)
      .set(auth(agentToken))
      .send({ decision: 'approve' })
      .expect(403);

    const approved = await request(http)
      .post(`/api/v1/dic/aliases/${target.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'approve' })
      .expect(200);
    expect(approved.body.approved).toBe(true);
    expect(approved.body.approvedById).toBeTruthy();
  });

  it('DA-5 an approved alias cannot be edited or re-decided', async () => {
    const list = await request(http)
      .get(`/api/v1/dic/drugs/${drugAId}/aliases`)
      .set(auth(managerToken))
      .expect(200);
    const approved = list.body.find((a: { alias: string }) => a.alias === 'Aliaso Drug');
    expect(approved).toBeDefined();

    await request(http)
      .patch(`/api/v1/dic/aliases/${approved.id}`)
      .set(auth(managerToken))
      .send({ alias: 'Changed' })
      .expect(400);
    await request(http)
      .post(`/api/v1/dic/aliases/${approved.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'approve' })
      .expect(400);
  });

  it('DA-6 a rejected alias is deactivated and cannot be decided again', async () => {
    const proposed = await request(http)
      .post(`/api/v1/dic/drugs/${drugAId}/aliases`)
      .set(auth(managerToken))
      .send({ alias: 'Reject Me', language: 'en', aliasType: 'COMMON_MISSPELLING' })
      .expect(201);

    const rejected = await request(http)
      .post(`/api/v1/dic/aliases/${proposed.body.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'reject', note: 'not a real variant' })
      .expect(200);
    expect(rejected.body.active).toBe(false);
    expect(rejected.body.approved).toBe(false);

    await request(http)
      .post(`/api/v1/dic/aliases/${proposed.body.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'approve' })
      .expect(400);
  });

  it('DA-7 an alias approved on one drug is surfaced as a duplicate candidate when proposed on another', async () => {
    const res = await request(http)
      .post(`/api/v1/dic/drugs/${drugBId}/aliases`)
      .set(auth(managerToken))
      .send({ alias: 'Aliaso Drug', language: 'en', aliasType: 'COMMON_MISSPELLING' })
      .expect(201);
    expect(res.body.duplicateOf).toHaveLength(1);
    expect(res.body.duplicateOf[0].id).toBe(drugAId);
  });

  // ── Alternative links ───────────────────────────────────────────────

  it('DA-8 dic.edit holders can propose an alternative link; self-links and duplicates are rejected', async () => {
    await request(http)
      .post(`/api/v1/dic/drugs/${drugAId}/alternative-links`)
      .set(auth(managerToken))
      .send({ alternativeDrugId: drugAId, alternativeType: 'GENERIC_ALTERNATIVE' })
      .expect(400);

    const created = await request(http)
      .post(`/api/v1/dic/drugs/${drugAId}/alternative-links`)
      .set(auth(managerToken))
      .send({ alternativeDrugId: drugBId, alternativeType: 'GENERIC_ALTERNATIVE' })
      .expect(201);
    expect(created.body.pharmacistApproved).toBe(false);

    await request(http)
      .post(`/api/v1/dic/drugs/${drugAId}/alternative-links`)
      .set(auth(managerToken))
      .send({ alternativeDrugId: drugBId, alternativeType: 'BRAND_ALTERNATIVE' })
      .expect(400);
  });

  it('DA-9 dic.approve_alternative approves a link, which then appears on the drug details as an approved alternative', async () => {
    const pending = await request(http)
      .get('/api/v1/dic/alternative-links/pending')
      .set(auth(managerToken))
      .expect(200);
    const target = pending.body.find(
      (l: { sourceDrugId: string; alternativeDrugId: string }) =>
        l.sourceDrugId === drugAId && l.alternativeDrugId === drugBId,
    );
    expect(target).toBeDefined();

    await request(http)
      .post(`/api/v1/dic/alternative-links/${target.id}/decide`)
      .set(auth(agentToken))
      .send({ decision: 'approve' })
      .expect(403);

    await request(http)
      .post(`/api/v1/dic/alternative-links/${target.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'approve' })
      .expect(200);

    const details = await request(http)
      .get(`/api/v1/dic/drugs/${drugAId}`)
      .set(auth(agentToken))
      .expect(200);
    const approvedLink = details.body.approvedAlternatives.find(
      (l: { alternativeDrug: { id: string } }) => l.alternativeDrug.id === drugBId,
    );
    expect(approvedLink).toBeDefined();
    expect(approvedLink.pharmacistApproved).toBe(true);
  });

  it('DA-10 an approved alternative link cannot be edited', async () => {
    const list = await request(http)
      .get(`/api/v1/dic/drugs/${drugAId}/alternative-links`)
      .set(auth(managerToken))
      .expect(200);
    const approved = list.body.find(
      (l: { alternativeDrugId: string }) => l.alternativeDrugId === drugBId,
    );
    expect(approved).toBeDefined();

    await request(http)
      .patch(`/api/v1/dic/alternative-links/${approved.id}`)
      .set(auth(managerToken))
      .send({ priority: 5 })
      .expect(400);
  });
});
