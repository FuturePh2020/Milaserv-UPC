import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'BranchExt#12345';
const TAG = 'e2e-branch-ext';

/**
 * Phase 6 Step 2 — Branch operational extensions: weekly/special hours,
 * service areas, and capabilities, plus the locator's earthdistance
 * upgrade's interaction with the new structured-hours resolver.
 */
describe('Branch Extensions (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let agentToken: string;
  let branchId: string;
  let cityId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.branch.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await prisma.branchCapability.deleteMany({ where: { code: { startsWith: TAG.toUpperCase() } } });
    await prisma.city.deleteMany({ where: { code: { startsWith: TAG.toUpperCase() } } });
    await prisma.region.deleteMany({ where: { code: { startsWith: TAG.toUpperCase() } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    await prisma.user.create({
      data: {
        email: `admin.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مدير',
        nameEn: `Admin ${TAG}`,
        roles: { create: { role: { connect: { key: 'SUPER_ADMIN' } } } },
      },
    });
    await prisma.user.create({
      data: {
        email: `agent.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: `Agent ${TAG}`,
        roles: { create: { role: { connect: { key: 'AGENT' } } } },
      },
    });
    const login = async (email: string) =>
      (
        await request(http)
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    adminToken = await login(`admin.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);

    const region = await prisma.region.create({
      data: { code: `${TAG.toUpperCase()}-R1`, nameEn: 'Test Region', nameAr: 'منطقة اختبار' },
    });
    const city = await prisma.city.create({
      data: {
        code: `${TAG.toUpperCase()}-C1`,
        regionId: region.id,
        nameEn: 'Test City',
        nameAr: 'مدينة اختبار',
        normalizedNameEn: 'test city',
        normalizedNameAr: 'مدينة اختبار',
      },
    });
    cityId = city.id;

    const branch = await prisma.branch.create({
      data: { code: `${TAG}-B1`, nameAr: 'فرع اختبار', nameEn: 'Test Branch', latitude: 24.71, longitude: 46.67 },
    });
    branchId = branch.id;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('BX-1 branch.manage is required to set weekly hours — agent gets 403', async () => {
    await request(http)
      .post(`/api/v1/branches/${branchId}/weekly-hours`)
      .set(auth(agentToken))
      .send({ dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' })
      .expect(403);
  });

  it('BX-2 an admin can set and re-set weekly hours (upsert per day-of-week)', async () => {
    const created = await request(http)
      .post(`/api/v1/branches/${branchId}/weekly-hours`)
      .set(auth(adminToken))
      .send({ dayOfWeek: 3, opensAt: '09:00', closesAt: '18:00' })
      .expect(201);
    expect(created.body.dayOfWeek).toBe(3);

    const updated = await request(http)
      .post(`/api/v1/branches/${branchId}/weekly-hours`)
      .set(auth(adminToken))
      .send({ dayOfWeek: 3, opensAt: '10:00', closesAt: '20:00' })
      .expect(201);
    // Same day-of-week updates the existing row rather than creating a duplicate.
    expect(updated.body.id).toBe(created.body.id);
    expect(updated.body.opensAt).toBe('10:00');

    const list = await request(http)
      .get(`/api/v1/branches/${branchId}/weekly-hours`)
      .set(auth(agentToken))
      .expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('BX-3 special hours override the weekly schedule for that date', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await request(http)
      .post(`/api/v1/branches/${branchId}/special-hours`)
      .set(auth(adminToken))
      .send({ date: today, isClosed: true, reason: 'Holiday' })
      .expect(201);

    const list = await request(http)
      .get(`/api/v1/branches/${branchId}/special-hours`)
      .set(auth(agentToken))
      .expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].isClosed).toBe(true);
  });

  it('BX-4 a CITY service area requires cityId (400 without it)', async () => {
    await request(http)
      .post(`/api/v1/branches/${branchId}/service-areas`)
      .set(auth(adminToken))
      .send({ serviceAreaType: 'CITY' })
      .expect(400);
  });

  it('BX-5 an admin can create and update a service area', async () => {
    const created = await request(http)
      .post(`/api/v1/branches/${branchId}/service-areas`)
      .set(auth(adminToken))
      .send({ serviceAreaType: 'CITY', cityId, deliveryEnabled: true, pickupEnabled: false })
      .expect(201);
    expect(created.body.cityId).toBe(cityId);

    const updated = await request(http)
      .patch(`/api/v1/branches/${branchId}/service-areas/${created.body.id}`)
      .set(auth(adminToken))
      .send({ pickupEnabled: true, priority: 5 })
      .expect(200);
    expect(updated.body.pickupEnabled).toBe(true);
    expect(updated.body.priority).toBe(5);

    const list = await request(http)
      .get(`/api/v1/branches/${branchId}/service-areas`)
      .set(auth(agentToken))
      .expect(200);
    expect(list.body.map((a: { id: string }) => a.id)).toContain(created.body.id);
  });

  it('BX-6 a RADIUS service area requires radiusKm + center coordinates', async () => {
    await request(http)
      .post(`/api/v1/branches/${branchId}/service-areas`)
      .set(auth(adminToken))
      .send({ serviceAreaType: 'RADIUS' })
      .expect(400);
    const ok = await request(http)
      .post(`/api/v1/branches/${branchId}/service-areas`)
      .set(auth(adminToken))
      .send({ serviceAreaType: 'RADIUS', radiusKm: 10, centerLatitude: 24.7, centerLongitude: 46.6 })
      .expect(201);
    expect(ok.body.radiusKm).toBe(10);
  });

  it('BX-7 an admin can create a capability and assign/unassign it to a branch', async () => {
    const cap = await request(http)
      .post('/api/v1/branches/capabilities')
      .set(auth(adminToken))
      .send({ code: `${TAG.toUpperCase()}_CAP`, nameEn: 'Test Capability', nameAr: 'قدرة اختبار' })
      .expect(201);

    const listAll = await request(http)
      .get('/api/v1/branches/capabilities')
      .set(auth(agentToken))
      .expect(200);
    expect(listAll.body.map((c: { code: string }) => c.code)).toContain(`${TAG.toUpperCase()}_CAP`);

    await request(http)
      .post(`/api/v1/branches/${branchId}/capabilities`)
      .set(auth(adminToken))
      .send({ capabilityId: cap.body.id })
      .expect(201);

    const assigned = await request(http)
      .get(`/api/v1/branches/${branchId}/capabilities`)
      .set(auth(agentToken))
      .expect(200);
    expect(assigned.body.map((a: { capabilityId: string }) => a.capabilityId)).toContain(cap.body.id);

    await request(http)
      .delete(`/api/v1/branches/${branchId}/capabilities/${cap.body.id}`)
      .set(auth(adminToken))
      .expect(204);

    const afterUnassign = await request(http)
      .get(`/api/v1/branches/${branchId}/capabilities`)
      .set(auth(agentToken))
      .expect(200);
    expect(afterUnassign.body.map((a: { capabilityId: string }) => a.capabilityId)).not.toContain(cap.body.id);
  });

  it('BX-8 the seeded starter capability catalog is present', async () => {
    const res = await request(http).get('/api/v1/branches/capabilities').set(auth(agentToken)).expect(200);
    const codes = res.body.map((c: { code: string }) => c.code);
    expect(codes).toEqual(expect.arrayContaining(['PRESCRIPTION_FULFILLMENT', 'COLD_CHAIN', 'SAME_DAY_DELIVERY']));
  });

  it("BX-9 the locator's earthdistance ordering still reflects the structured weekly-hours override", async () => {
    // From BX-2/BX-3: today's special hours say closed. Regardless of
    // weekly hours or the legacy field, the locator must report closed.
    await prisma.setting.update({
      where: { key_scopeLevel_scopeId: { key: 'branch.locator.max_results', scopeLevel: 'SYSTEM', scopeId: '' } },
      data: { value: 1000 },
    });
    const res = await request(http)
      .get('/api/v1/branches/nearest?lat=24.71&lng=46.67')
      .set(auth(agentToken))
      .expect(200);
    const mine = (res.body.results as { id: string; open: boolean }[]).find((r) => r.id === branchId);
    expect(mine).toBeDefined();
    expect(mine!.open).toBe(false);
  });
});
