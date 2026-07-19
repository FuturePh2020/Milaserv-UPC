import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'DicRef#12345';
const TAG = 'e2e-dic-ref';

/**
 * CR-002 Phase 4 — DIC Drug Master & Normalization Foundation: the
 * controlled reference catalogs (dosage forms, units, countries,
 * manufacturers, therapeutic classes, active ingredients). Distinct
 * suite from dic.e2e-spec.ts (Sprint P9's search/import/approval flows,
 * unaffected by this phase).
 */
describe('DIC Reference Catalogs (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let managerToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.dosageForm.deleteMany({ where: { code: { startsWith: 'E2ETEST_' } } });
    await prisma.measurementUnit.deleteMany({ where: { code: { startsWith: 'e2etest_' } } });
    await prisma.country.deleteMany({ where: { isoCode: 'ZZ' } });
    await prisma.manufacturer.deleteMany({ where: { nameEn: { startsWith: 'E2E Test Mfr' } } });
    await prisma.therapeuticClass.deleteMany({ where: { code: { startsWith: 'E2ETEST_' } } });
    await prisma.activeIngredient.deleteMany({
      where: { scientificNameEn: { startsWith: 'E2E Test Ingredient' } },
    });
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

  it('DR-1 dic.view holders can list every reference catalog', async () => {
    for (const path of [
      'dosage-forms',
      'units',
      'countries',
      'manufacturers',
      'therapeutic-classes',
      'active-ingredients',
    ]) {
      const res = await request(http)
        .get(`/api/v1/dic/reference/${path}`)
        .set(auth(agentToken))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
  });

  it('DR-2 the seeded catalogs are non-empty (Phase 4 seed data)', async () => {
    const forms = await request(http)
      .get('/api/v1/dic/reference/dosage-forms')
      .set(auth(agentToken))
      .expect(200);
    expect(forms.body.length).toBeGreaterThanOrEqual(13);
    const units = await request(http)
      .get('/api/v1/dic/reference/units')
      .set(auth(agentToken))
      .expect(200);
    expect(units.body.length).toBeGreaterThanOrEqual(10);
    const classes = await request(http)
      .get('/api/v1/dic/reference/therapeutic-classes')
      .set(auth(agentToken))
      .expect(200);
    expect(classes.body.length).toBeGreaterThanOrEqual(12);
  });

  it('DR-3 mutating structural catalogs (dosage forms) requires dic.admin — agent and manager are refused', async () => {
    await request(http)
      .post('/api/v1/dic/reference/dosage-forms')
      .set(auth(agentToken))
      .send({ code: 'E2ETEST_PATCH', nameEn: 'Patch', nameAr: 'لصقة' })
      .expect(403);
    await request(http)
      .post('/api/v1/dic/reference/dosage-forms')
      .set(auth(managerToken))
      .send({ code: 'E2ETEST_PATCH', nameEn: 'Patch', nameAr: 'لصقة' })
      .expect(403);
  });

  it('DR-4 dic.admin can create and update a dosage form, with normalized search fields set', async () => {
    const created = await request(http)
      .post('/api/v1/dic/reference/dosage-forms')
      .set(auth(adminToken))
      .send({ code: 'E2ETEST_PATCH', nameEn: 'Skin Patch', nameAr: 'لصقة جلدية' })
      .expect(201);
    expect(created.body.normalizedNameEn).toBe('skin patch');
    expect(created.body.active).toBe(true);

    const updated = await request(http)
      .patch(`/api/v1/dic/reference/dosage-forms/${created.body.id}`)
      .set(auth(adminToken))
      .send({ active: false })
      .expect(200);
    expect(updated.body.active).toBe(false);
  });

  it('DR-5 dic.edit holders (manager) can create a manufacturer, but only dic.admin can edit one', async () => {
    const created = await request(http)
      .post('/api/v1/dic/reference/manufacturers')
      .set(auth(managerToken))
      .send({ nameEn: 'E2E Test Mfr Co' })
      .expect(201);
    expect(created.body.normalizedNameEn).toBe('e2e test mfr co');

    await request(http)
      .patch(`/api/v1/dic/reference/manufacturers/${created.body.id}`)
      .set(auth(managerToken))
      .send({ active: false })
      .expect(403);

    await request(http)
      .patch(`/api/v1/dic/reference/manufacturers/${created.body.id}`)
      .set(auth(adminToken))
      .send({ active: false })
      .expect(200);
  });

  it('DR-6 active ingredients get both normalized and search name fields populated', async () => {
    const created = await request(http)
      .post('/api/v1/dic/reference/active-ingredients')
      .set(auth(managerToken))
      .send({ scientificNameEn: 'E2E Test Ingredient', scientificNameAr: 'مكون تجريبي' })
      .expect(201);
    expect(created.body.normalizedScientificNameEn).toBe('e2e test ingredient');
    expect(created.body.searchNameAr).toBe('مكون تجريبي');
  });

  it('DR-7 a therapeutic class cannot be made its own parent', async () => {
    const created = await request(http)
      .post('/api/v1/dic/reference/therapeutic-classes')
      .set(auth(adminToken))
      .send({ code: 'E2ETEST_SELFPARENT', nameEn: 'Self Parent Test', nameAr: 'اختبار' })
      .expect(201);
    await request(http)
      .patch(`/api/v1/dic/reference/therapeutic-classes/${created.body.id}`)
      .set(auth(adminToken))
      .send({ parentId: created.body.id })
      .expect(400);
  });

  it('DR-8 unknown record ids 404 instead of silently succeeding', async () => {
    await request(http)
      .patch('/api/v1/dic/reference/countries/nonexistent-id')
      .set(auth(adminToken))
      .send({ active: false })
      .expect(404);
  });
});
