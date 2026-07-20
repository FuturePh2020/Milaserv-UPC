import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'LocTest#12345';
const TAG = 'e2e-locations';

/**
 * Phase 6 Step 1 — Location-Aware Branch Inventory & Fulfillment Engine:
 * the location hierarchy (Region/City/District/LocationAlias) reference
 * CRUD and the Branch-to-hierarchy backfill matcher.
 */
describe('Location Hierarchy (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.branch.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await prisma.locationAlias.deleteMany({ where: { alias: { startsWith: TAG } } });
    await prisma.district.deleteMany({ where: { code: { startsWith: TAG.toUpperCase() } } });
    await prisma.city.deleteMany({ where: { code: { startsWith: TAG.toUpperCase() } } });
    await prisma.region.deleteMany({ where: { code: { startsWith: TAG.toUpperCase() } } });
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
    await mk(`agent.${TAG}@milaserv360.test`, 'AGENT');

    const login = async (email: string) =>
      (
        await request(http)
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    adminToken = await login(`admin.${TAG}@milaserv360.test`);
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

  it('LOC-1 location.view holders can list every hierarchy level', async () => {
    for (const path of ['regions', 'cities', 'districts', 'aliases']) {
      const res = await request(http)
        .get(`/api/v1/locations/${path}`)
        .set(auth(agentToken))
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    }
  });

  it('LOC-2 the seeded KSA hierarchy is non-empty (13 regions, 27+ cities)', async () => {
    const regions = await request(http).get('/api/v1/locations/regions').set(auth(agentToken)).expect(200);
    expect(regions.body.length).toBeGreaterThanOrEqual(13);
    const cities = await request(http).get('/api/v1/locations/cities').set(auth(agentToken)).expect(200);
    expect(cities.body.length).toBeGreaterThanOrEqual(27);
  });

  it('LOC-3 location.manage is required to mutate — a view-only agent gets 403', async () => {
    await request(http)
      .post('/api/v1/locations/regions')
      .set(auth(agentToken))
      .send({ code: `${TAG.toUpperCase()}-R1`, nameEn: 'Test Region', nameAr: 'منطقة اختبار' })
      .expect(403);
  });

  let regionId: string;
  let cityId: string;
  let districtId: string;

  it('LOC-4 an admin can build a full Region → City → District chain', async () => {
    const region = await request(http)
      .post('/api/v1/locations/regions')
      .set(auth(adminToken))
      .send({ code: `${TAG.toUpperCase()}-R1`, nameEn: 'Test Region', nameAr: 'منطقة اختبار' })
      .expect(201);
    regionId = region.body.id;

    const city = await request(http)
      .post('/api/v1/locations/cities')
      .set(auth(adminToken))
      .send({
        code: `${TAG.toUpperCase()}-C1`,
        regionId,
        nameEn: 'Test City',
        nameAr: 'مدينة اختبار',
        latitude: 24.7,
        longitude: 46.6,
      })
      .expect(201);
    cityId = city.body.id;
    expect(city.body.normalizedNameEn).toBe('test city');

    const district = await request(http)
      .post('/api/v1/locations/districts')
      .set(auth(adminToken))
      .send({ code: `${TAG.toUpperCase()}-D1`, cityId, nameEn: 'Test District', nameAr: 'حي اختبار' })
      .expect(201);
    districtId = district.body.id;

    const cities = await request(http)
      .get(`/api/v1/locations/cities?regionId=${regionId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(cities.body.map((c: { id: string }) => c.id)).toContain(cityId);

    const districts = await request(http)
      .get(`/api/v1/locations/districts?cityId=${cityId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(districts.body.map((d: { id: string }) => d.id)).toContain(districtId);
  });

  it('LOC-5 creating a City with an unknown regionId is rejected (400), never silently orphaned', async () => {
    await request(http)
      .post('/api/v1/locations/cities')
      .set(auth(adminToken))
      .send({ code: `${TAG.toUpperCase()}-CBAD`, regionId: 'nonexistent-region-id', nameEn: 'Bad', nameAr: 'سيء' })
      .expect(400);
  });

  it('LOC-6 an alias lets the backfill resolve a spelling variant it would otherwise miss', async () => {
    await request(http)
      .post('/api/v1/locations/aliases')
      .set(auth(adminToken))
      .send({ entityType: 'CITY', entityId: cityId, alias: `${TAG} City Variant`, language: 'en' })
      .expect(201);

    const branch = await prisma.branch.create({
      data: {
        code: `${TAG}-B1`,
        nameAr: 'فرع اختبار',
        nameEn: 'Test Branch',
        city: `${TAG} City Variant`,
        district: 'Test District',
      },
    });

    await request(http).post('/api/v1/locations/backfill-branches').set(auth(adminToken)).expect(201);

    const updated = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    expect(updated.locationCityId).toBe(cityId);
    expect(updated.locationDistrictId).toBe(districtId);
    expect(updated.locationMatchStatus).toBe('AUTO_MATCHED');
  });

  it('LOC-7 a branch whose city text matches nothing is flagged NEEDS_REVIEW, never guessed', async () => {
    const branch = await prisma.branch.create({
      data: {
        code: `${TAG}-B2`,
        nameAr: 'فرع غامض',
        nameEn: 'Ambiguous Branch',
        city: `${TAG} Totally Unknown City Text`,
      },
    });

    await request(http).post('/api/v1/locations/backfill-branches').set(auth(adminToken)).expect(201);

    const updated = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    expect(updated.locationCityId).toBeNull();
    expect(updated.locationMatchStatus).toBe('NEEDS_REVIEW');
  });

  it('LOC-8 a MANUALLY_CONFIRMED branch is never touched by a re-run backfill', async () => {
    const branch = await prisma.branch.create({
      data: {
        code: `${TAG}-B3`,
        nameAr: 'فرع مؤكد',
        nameEn: 'Confirmed Branch',
        city: `${TAG} City Variant`,
        locationCityId: cityId,
        locationMatchStatus: 'MANUALLY_CONFIRMED',
      },
    });

    await request(http).post('/api/v1/locations/backfill-branches').set(auth(adminToken)).expect(201);

    const updated = await prisma.branch.findUniqueOrThrow({ where: { id: branch.id } });
    expect(updated.locationMatchStatus).toBe('MANUALLY_CONFIRMED');
    expect(updated.locationCityId).toBe(cityId);
  });

  it('LOC-9 the data-quality endpoint reports real branch counts', async () => {
    const res = await request(http)
      .get('/api/v1/locations/data-quality')
      .set(auth(agentToken))
      .expect(200);
    expect(typeof res.body.totalBranches).toBe('number');
    expect(res.body.totalBranches).toBeGreaterThanOrEqual(3);
    expect(res.body.byMatchStatus).toBeDefined();
  });
});
