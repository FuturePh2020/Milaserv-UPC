import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Branch#12345';
const TAG = 'e2e-bc';

// United Locations export headers (branch-center spec G2).
const row = (over: Record<string, unknown>) => ({
  'SAP Store Code': '',
  'Store Code': '',
  'Pharmacy Name': '',
  'Store Type': 'Offline',
  'Delivery Coverage': 'Covered',
  'District Manager': 'DM',
  'Area Manager': 'AM',
  Supervisor: 'Supervisor X',
  'English Address': 'Somewhere St',
  'Arabic Address': 'شارع ما',
  Location: 'https://maps.example/x',
  City: 'Jeddah',
  District: 'Muraikh',
  Region: 'Jeddah',
  'Postal Code': 23252,
  Latitude: 21.5,
  Longitude: 39.2,
  'Primary Phone': 8002444445,
  'Pharmacy Phone': 55681755,
  'Another Phone': '',
  ...over,
});

describe('Branch Center (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  const setMaxResults = (value: number) =>
    prisma.setting.update({
      where: {
        key_scopeLevel_scopeId: {
          key: 'branch.locator.max_results',
          scopeLevel: 'SYSTEM',
          scopeId: '',
        },
      },
      data: { value },
    });

  async function cleanup() {
    await prisma.branch.deleteMany({ where: { code: { startsWith: 'EBC' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await setMaxResults(5);
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
    // The dev DB may hold the real 608-branch master; widen the locator so
    // the test fixtures always appear regardless of surrounding data.
    await setMaxResults(1000);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('BC-1 §16.2 type catalog is seeded verbatim', async () => {
    const res = await request(http).get('/api/v1/branches/types').set(auth(agentToken)).expect(200);
    const keys = res.body.map((t: { key: string }) => t.key).sort();
    expect(keys).toEqual(['DARK_STORE', 'OFFLINE_BRANCH', 'ONLINE_STORE', 'RAQEEB_BRANCH']);
  });

  it('BC-2 import preview validates and quality-flags without writing (G2, §26)', async () => {
    const res = await request(http)
      .post('/api/v1/branches/import/preview')
      .set(auth(adminToken))
      .send({
        fileName: 'united.xlsx',
        rows: [
          row({ 'SAP Store Code': 'EBC1', 'Pharmacy Name': 'United 901' }),
          // Store Code fallback when SAP code missing
          row({ 'Store Code': 'EBC2', 'Pharmacy Name': 'United 902', 'Store Type': 'Weird' }),
          // missing both codes → invalid
          row({ 'Pharmacy Name': 'United 903' }),
          // duplicate code in file → invalid
          row({ 'SAP Store Code': 'EBC1', 'Pharmacy Name': 'United 904' }),
          // missing location + supervisor → flagged, still valid
          row({
            'SAP Store Code': 'EBC3',
            'Pharmacy Name': 'United 905',
            Latitude: '',
            Longitude: '',
            Supervisor: '',
          }),
        ],
      })
      .expect(200);
    expect(res.body.counts).toMatchObject({
      valid: 3,
      invalid: 2,
      willCreate: 3,
      willUpdate: 0,
      missingLocation: 1,
      missingSupervisor: 1,
      unmappedType: 1,
    });
    expect(await prisma.branch.count({ where: { code: { startsWith: 'EBC' } } })).toBe(0);
  });

  it('BC-3 import is a master-data upsert: create then update in place (G3)', async () => {
    const first = await request(http)
      .post('/api/v1/branches/import')
      .set(auth(adminToken))
      .send({
        fileName: 'united.xlsx',
        rows: [
          row({ 'SAP Store Code': 'EBC1', 'Pharmacy Name': 'United 901' }),
          row({
            'SAP Store Code': 'EBC2',
            'Pharmacy Name': 'United 902',
            'Store Type': 'Online Dark store',
            Latitude: 21.51,
            Longitude: 39.21,
          }),
          row({
            'SAP Store Code': 'EBC3',
            'Pharmacy Name': 'United 903',
            'Delivery Coverage': 'Not Covered',
            Latitude: 21.52,
            Longitude: 39.22,
          }),
          row({
            'SAP Store Code': 'EBC4',
            'Pharmacy Name': 'United 904',
            Region: 'Riyadh',
            City: 'Riyadh',
            Latitude: 24.7,
            Longitude: 46.7,
          }),
        ],
      })
      .expect(201);
    expect(first.body).toMatchObject({ created: 4, updated: 0 });

    const b1 = await prisma.branch.findUniqueOrThrow({ where: { code: 'EBC1' } });
    expect(b1.nameAr).toBe('المتحدة 901');
    expect(b1.branchTypeKey).toBe('OFFLINE_BRANCH');
    expect(b1.deliveryCovered).toBe(true);
    expect(b1.supervisorName).toBe('Supervisor X');
    const b2 = await prisma.branch.findUniqueOrThrow({ where: { code: 'EBC2' } });
    expect(b2.branchTypeKey).toBe('DARK_STORE');

    // Monthly re-import: supervisor changed → §9.8 mapping stays fresh.
    const second = await request(http)
      .post('/api/v1/branches/import')
      .set(auth(adminToken))
      .send({
        fileName: 'united-2.xlsx',
        rows: [
          row({ 'SAP Store Code': 'EBC1', 'Pharmacy Name': 'United 901', Supervisor: 'New Sup' }),
        ],
      })
      .expect(201);
    expect(second.body).toMatchObject({ created: 0, updated: 1 });
    const b1b = await prisma.branch.findUniqueOrThrow({ where: { code: 'EBC1' } });
    expect(b1b.supervisorName).toBe('New Sup');
    expect(await prisma.branch.count({ where: { code: 'EBC1' } })).toBe(1);
  });

  it('BC-4 import requires branch.manage; viewers get 403', async () => {
    await request(http)
      .post('/api/v1/branches/import')
      .set(auth(agentToken))
      .send({ fileName: 'x.xlsx', rows: [row({ 'SAP Store Code': 'EBC9' })] })
      .expect(403);
  });

  it('BC-5 list supports region and type filters (§16.1)', async () => {
    const res = await request(http)
      .get('/api/v1/branches?region=Riyadh&page=1&pageSize=10')
      .set(auth(agentToken))
      .expect(200);
    const codes = (res.body.items as { code: string }[]).map((b) => b.code);
    expect(codes).toContain('EBC4');
    expect(codes).not.toContain('EBC1');

    const dark = await request(http)
      .get('/api/v1/branches?typeKey=DARK_STORE&q=United 90')
      .set(auth(agentToken))
      .expect(200);
    expect((dark.body.items as { code: string }[]).map((b) => b.code)).toEqual(['EBC2']);
  });

  it('BC-6 locator ranks by Haversine distance (§16.3)', async () => {
    const res = await request(http)
      .get('/api/v1/branches/nearest?lat=21.5&lng=39.2')
      .set(auth(agentToken))
      .expect(200);
    const codes = (res.body.results as { code: string; distanceKm: number }[])
      .filter((r) => r.code.startsWith('EBC'))
      .map((r) => r.code);
    expect(codes.slice(0, 3)).toEqual(['EBC1', 'EBC2', 'EBC3']);
    const first = (res.body.results as { code: string; distanceKm: number }[]).find(
      (r) => r.code === 'EBC1',
    );
    expect(first!.distanceKm).toBeLessThan(0.1);
  });

  it('BC-7 delivery estimator: ETA formula + NOT_COVERED reason (G5)', async () => {
    const res = await request(http)
      .get('/api/v1/branches/nearest?lat=21.5&lng=39.2')
      .set(auth(agentToken))
      .expect(200);
    const results = res.body.results as {
      code: string;
      distanceKm: number;
      deliveryEtaMinutes: number | null;
      deliveryUnavailableReason: string | null;
    }[];

    const b1 = results.find((r) => r.code === 'EBC1')!;
    // base 15 + distance(≈0) × 3 → 15
    expect(b1.deliveryEtaMinutes).toBe(15);
    expect(b1.deliveryUnavailableReason).toBeNull();

    const b2 = results.find((r) => r.code === 'EBC2')!;
    expect(b2.deliveryEtaMinutes).toBe(Math.round(15 + b2.distanceKm * 3));

    const b3 = results.find((r) => r.code === 'EBC3')!;
    expect(b3.deliveryEtaMinutes).toBeNull();
    expect(b3.deliveryUnavailableReason).toBe('NOT_COVERED');
  });

  it('BC-8 out-of-range and closed branches carry reasons (G5/G6)', async () => {
    // Riyadh branch viewed from Riyadh is in range; from Jeddah it is ~850km.
    const far = await request(http)
      .get('/api/v1/branches/nearest?lat=24.71&lng=46.71')
      .set(auth(agentToken))
      .expect(200);
    const ebc4 = (far.body.results as { code: string; deliveryEtaMinutes: number | null }[]).find(
      (r) => r.code === 'EBC4',
    );
    expect(ebc4!.deliveryEtaMinutes).not.toBeNull();

    // Close EBC1 via working hours (1-minute window long past).
    await prisma.branch.update({
      where: { code: 'EBC1' },
      data: { workingHours: { from: '03:00', to: '03:01' } },
    });
    const res = await request(http)
      .get('/api/v1/branches/nearest?lat=21.5&lng=39.2')
      .set(auth(agentToken))
      .expect(200);
    const b1 = (
      res.body.results as {
        code: string;
        open: boolean;
        deliveryUnavailableReason: string | null;
      }[]
    ).find((r) => r.code === 'EBC1')!;
    expect(b1.open).toBe(false);
    expect(b1.deliveryUnavailableReason).toBe('CLOSED');
  });

  it('BC-9 invalid coordinates are rejected', async () => {
    await request(http)
      .get('/api/v1/branches/nearest?lat=999&lng=39.2')
      .set(auth(agentToken))
      .expect(400);
  });
});
