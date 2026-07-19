import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'DicQuality#12345';
const TAG = 'e2e-dic-quality';

/**
 * CR-002 Phase 4 Step 6 — controlled drug merge, optimistic-locked
 * field edits, and the data-quality dashboard (design doc §22/§18).
 */
describe('DIC Merge, Versioning & Data Quality (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let managerToken: string;
  let reviewerToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9EDICQUALITY' } } });
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
    await mk(`admin.${TAG}@milaserv360.test`, 'SUPER_ADMIN');
    await mk(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER');
    // dic.pharmacist_review is granted to BUSINESS_EXCELLENCE_MANAGER,
    // not TEAM_MANAGER — a distinct reviewer identity for QU-8..10.
    await mk(`reviewer.${TAG}@milaserv360.test`, 'BUSINESS_EXCELLENCE_MANAGER');
    await mk(`agent.${TAG}@milaserv360.test`, 'AGENT');

    const login = async (email: string) =>
      (
        await request(http)
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    adminToken = await login(`admin.${TAG}@milaserv360.test`);
    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    reviewerToken = await login(`reviewer.${TAG}@milaserv360.test`);
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

  // ── Optimistic-locked field edits ───────────────────────────────────

  it('QU-1 updating drug fields with a stale expectedVersion is rejected with 409', async () => {
    const drug = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_V1', nameEn: 'Version Test Drug' },
    });

    await request(http)
      .patch(`/api/v1/dic/drugs/${drug.id}/fields`)
      .set(auth(managerToken))
      .send({ expectedVersion: 99, strengthText: '10 mg' })
      .expect(409);

    const updated = await request(http)
      .patch(`/api/v1/dic/drugs/${drug.id}/fields`)
      .set(auth(managerToken))
      .send({ expectedVersion: 0, strengthText: '10 mg' })
      .expect(200);
    expect(updated.body.version).toBe(1);
    expect(updated.body.strengthText).toBe('10 mg');

    // Same expectedVersion (0) again now fails, since the row moved to 1.
    await request(http)
      .patch(`/api/v1/dic/drugs/${drug.id}/fields`)
      .set(auth(managerToken))
      .send({ expectedVersion: 0, strengthText: '20 mg' })
      .expect(409);
  });

  it('QU-2 dic.view-only users cannot edit drug fields', async () => {
    const drug = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_V2', nameEn: 'Permission Test Drug' },
    });
    await request(http)
      .patch(`/api/v1/dic/drugs/${drug.id}/fields`)
      .set(auth(agentToken))
      .send({ expectedVersion: 0, strengthText: '5 mg' })
      .expect(403);
  });

  // ── Merge ────────────────────────────────────────────────────────────

  it('QU-3 dic.edit (without dic.admin) cannot merge drugs', async () => {
    const a = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_MA', nameEn: 'Merge A' },
    });
    const b = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_MB', nameEn: 'Merge B' },
    });
    await request(http)
      .post(`/api/v1/dic/drugs/${a.id}/merge`)
      .set(auth(managerToken))
      .send({ targetDrugId: b.id })
      .expect(403);
  });

  it('QU-4 merging moves non-conflicting aliases/coverage/alternatives and redirects the source', async () => {
    const source = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_SRC', nameEn: 'Duplicate Drug Source' },
    });
    const target = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_TGT', nameEn: 'Canonical Drug Target' },
    });
    const other = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_OTH', nameEn: 'Third Drug' },
    });

    await prisma.drugAlias.create({
      data: {
        drugId: source.id,
        alias: 'Only On Source',
        normalizedAlias: 'only on source',
        language: 'en',
        aliasType: 'COMMON_MISSPELLING',
        source: 'MANUAL',
      },
    });
    // A conflicting alias that already exists on target with the same
    // normalized text — the source's copy must be dropped, not duplicated.
    await prisma.drugAlias.create({
      data: {
        drugId: target.id,
        alias: 'Shared Alias',
        normalizedAlias: 'shared alias',
        language: 'en',
        aliasType: 'COMMON_MISSPELLING',
        source: 'MANUAL',
      },
    });
    await prisma.drugAlias.create({
      data: {
        drugId: source.id,
        alias: 'Shared Alias',
        normalizedAlias: 'shared alias',
        language: 'en',
        aliasType: 'COMMON_MISSPELLING',
        source: 'MANUAL',
      },
    });
    await prisma.drugAlternativeLink.create({
      data: {
        sourceDrugId: source.id,
        alternativeDrugId: other.id,
        alternativeType: 'GENERIC_ALTERNATIVE',
      },
    });

    const res = await request(http)
      .post(`/api/v1/dic/drugs/${source.id}/merge`)
      .set(auth(adminToken))
      .send({ targetDrugId: target.id, reason: 'Duplicate master data entry' })
      .expect(200);
    expect(res.body.source.mergedIntoDrugId).toBe(target.id);
    expect(res.body.source.active).toBe(false);

    const targetAliases = await prisma.drugAlias.findMany({ where: { drugId: target.id } });
    expect(targetAliases.map((a) => a.normalizedAlias).sort()).toEqual([
      'only on source',
      'shared alias',
    ]);
    // The source's duplicate "Shared Alias" was dropped, not duplicated.
    const remainingSourceAliases = await prisma.drugAlias.findMany({
      where: { drugId: source.id },
    });
    expect(remainingSourceAliases).toHaveLength(0);

    const repointedLink = await prisma.drugAlternativeLink.findUnique({
      where: {
        sourceDrugId_alternativeDrugId: { sourceDrugId: target.id, alternativeDrugId: other.id },
      },
    });
    expect(repointedLink).toBeTruthy();

    // GET on the merged-away drug still resolves (a redirect, not a 404).
    const details = await request(http)
      .get(`/api/v1/dic/drugs/${source.id}`)
      .set(auth(agentToken))
      .expect(200);
    expect(details.body.mergedIntoDrugId).toBe(target.id);
  });

  it('QU-5 a merged-away drug no longer appears in search results', async () => {
    const res = await request(http)
      .get('/api/v1/dic/search?q=Duplicate Drug Source&field=nameEn')
      .set(auth(agentToken))
      .expect(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('QU-6 merging a drug into itself, or into an already-merged drug, is rejected', async () => {
    const solo = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_SOLO', nameEn: 'Solo Drug' },
    });
    await request(http)
      .post(`/api/v1/dic/drugs/${solo.id}/merge`)
      .set(auth(adminToken))
      .send({ targetDrugId: solo.id })
      .expect(400);

    const mergedSource = await prisma.drug.findFirst({ where: { materialNo: '9EDICQUALITY_SRC' } });
    await request(http)
      .post(`/api/v1/dic/drugs/${solo.id}/merge`)
      .set(auth(adminToken))
      .send({ targetDrugId: mergedSource!.id })
      .expect(400);
  });

  it('QU-7 merge honors expectedSourceVersion/expectedTargetVersion as an optimistic lock', async () => {
    const a = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_LA', nameEn: 'Lock A' },
    });
    const b = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_LB', nameEn: 'Lock B' },
    });
    await request(http)
      .post(`/api/v1/dic/drugs/${a.id}/merge`)
      .set(auth(adminToken))
      .send({ targetDrugId: b.id, expectedSourceVersion: 5 })
      .expect(409);
  });

  // ── Data-quality status & dashboard ─────────────────────────────────

  it('QU-8 dic.pharmacist_review can set a drug to VERIFIED, stamping approvedBy/At', async () => {
    const drug = await prisma.drug.create({
      data: { materialNo: '9EDICQUALITY_DQ', nameEn: 'Quality Status Drug' },
    });
    const res = await request(http)
      .post(`/api/v1/dic/drugs/${drug.id}/quality/status`)
      .set(auth(reviewerToken))
      .send({ status: 'VERIFIED', note: 'reviewed against SFDA listing' })
      .expect(200);
    expect(res.body.dataQualityStatus).toBe('VERIFIED');
    expect(res.body.approvedById).toBeTruthy();
  });

  it('QU-9 the dashboard reports totals, status breakdown, and missing-field counts', async () => {
    const res = await request(http)
      .get('/api/v1/dic/quality/dashboard')
      .set(auth(reviewerToken))
      .expect(200);
    expect(typeof res.body.totalActiveDrugs).toBe('number');
    expect(res.body.byDataQualityStatus).toBeDefined();
    expect(res.body.missingFields).toHaveProperty('nameAr');
    expect(res.body.missingFields).toHaveProperty('dosageForm');
    expect(typeof res.body.mergedDrugs).toBe('number');
    expect(res.body.mergedDrugs).toBeGreaterThanOrEqual(1);
  });

  it('QU-10 quality issue drill-down rejects an unknown rule and lists drugs for a known one', async () => {
    await request(http)
      .get('/api/v1/dic/quality/issues?rule=not_a_real_rule')
      .set(auth(reviewerToken))
      .expect(400);

    const res = await request(http)
      .get('/api/v1/dic/quality/issues?rule=missing_dosage_form&limit=5')
      .set(auth(reviewerToken))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(5);
  });

  it('QU-11 dic.view-only users cannot see the quality dashboard', async () => {
    await request(http).get('/api/v1/dic/quality/dashboard').set(auth(agentToken)).expect(403);
  });
});
