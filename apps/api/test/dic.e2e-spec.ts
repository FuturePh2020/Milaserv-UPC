import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Dic#12345';
const TAG = 'e2e-dic';

// Mapping export headers (dic spec H1).
const row = (over: Record<string, unknown>) => ({
  Material: '',
  'Material Description': '',
  AR: '',
  RSP: 10,
  RSP_with_Tax: 11.5,
  Brand: 'TestBrand',
  Division: 'Health Care',
  Category: 'Wellness',
  'SFDA CODE': '',
  'Meena Coverage': 'Not Covered',
  'Item Type': 'Normal Item',
  Raqeep: 'Not Raqeeb',
  'Med. Coverage': 'Taw.N.Covered',
  'Acute / Chronic': 'Normal Sales',
  'Mapped Product 1': '',
  'Combined Products': '',
  Jeddah: '',
  ...over,
});

describe('DIC (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let managerToken: string;
  let agentToken: string;
  let drugId: string;
  let requestId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9EDIC' } } });
    await prisma.insuranceCompany.deleteMany({ where: { key: 'AXA_TEST' } });
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
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('DI-1 import requires dic.manage; agents can still search', async () => {
    await request(http)
      .post('/api/v1/dic/import')
      .set(auth(agentToken))
      .send({ fileName: 'x.xlsx', rows: [row({ Material: '9EDIC1' })] })
      .expect(403);
    await request(http).get('/api/v1/dic/search?q=whatever').set(auth(agentToken)).expect(200);
  });

  it('DI-2 chunk import: create, quality counts, then upsert on re-import (H1/H2)', async () => {
    const first = await request(http)
      .post('/api/v1/dic/import')
      .set(auth(managerToken))
      .send({
        fileName: 'mapping.xlsx',
        rows: [
          row({
            Material: '9EDIC1',
            'Material Description': 'Panadex 500mg Tab',
            AR: 'بانادكس ٥٠٠',
            'SFDA CODE': 'SFDA-1',
            'Meena Coverage': 'Covered',
            'Med. Coverage': 'Taw.Covered',
            'Mapped Product 1': '9EDIC2',
            'Combined Products': '9EDIC3',
            Jeddah: 12,
            Riyadh: 3,
          }),
          row({
            Material: '9EDIC2',
            'Material Description': 'Panadex Extra Tab',
            'Item Type': 'Special Items',
            Raqeep: 'Raqeeb',
          }),
          row({ Material: '9EDIC3', 'Material Description': 'Vitamin C Chewable' }),
          row({ 'Material Description': 'No material row' }),
          row({ Material: '9EDIC1', 'Material Description': 'Duplicate in chunk' }),
        ],
      })
      .expect(200);
    expect(first.body.created).toBe(3);
    expect(first.body.updated).toBe(0);
    expect(first.body.invalid).toHaveLength(2);
    expect(first.body.quality.missingArabicName).toBe(2);
    expect(first.body.quality.notCoded).toBe(2);

    const d1 = await prisma.drug.findUniqueOrThrow({ where: { materialNo: '9EDIC1' } });
    drugId = d1.id;
    expect(d1.coded).toBe(true);
    expect(d1.itemTypeKey).toBe('NORMAL');
    expect(d1.availability).toEqual({ Jeddah: 12, Riyadh: 3 });
    const d2 = await prisma.drug.findUniqueOrThrow({ where: { materialNo: '9EDIC2' } });
    expect(d2.itemTypeKey).toBe('SPECIAL');
    expect(d2.raqeeb).toBe(true);

    // Monthly re-import updates in place (price change), never duplicates.
    const second = await request(http)
      .post('/api/v1/dic/import')
      .set(auth(managerToken))
      .send({
        fileName: 'mapping-2.xlsx',
        rows: [
          row({
            Material: '9EDIC1',
            'Material Description': 'Panadex 500mg Tab',
            AR: 'بانادكس ٥٠٠',
            RSP_with_Tax: 13.8,
            'SFDA CODE': 'SFDA-1',
            'Meena Coverage': 'Covered',
            'Med. Coverage': 'Taw.Covered',
            'Mapped Product 1': '9EDIC2',
            'Combined Products': '9EDIC3',
            Jeddah: 12,
            Riyadh: 3,
          }),
        ],
      })
      .expect(200);
    expect(second.body).toMatchObject({ created: 0, updated: 1 });
    const updated = await prisma.drug.findUniqueOrThrow({ where: { materialNo: '9EDIC1' } });
    expect(Number(updated.priceWithTax)).toBe(13.8);
    expect(await prisma.drug.count({ where: { materialNo: '9EDIC1' } })).toBe(1);
  });

  it('DI-3 §15.1 search: fields, partial, wildcard *, auto-complete limit', async () => {
    const partial = await request(http)
      .get('/api/v1/dic/search?q=anade&field=nameEn')
      .set(auth(agentToken))
      .expect(200);
    expect((partial.body.items as { materialNo: string }[]).map((d) => d.materialNo)).toEqual(
      expect.arrayContaining(['9EDIC1', '9EDIC2']),
    );

    const arabic = await request(http)
      .get(`/api/v1/dic/search?q=${encodeURIComponent('بانادكس')}&field=nameAr`)
      .set(auth(agentToken))
      .expect(200);
    expect((arabic.body.items as { materialNo: string }[])[0]?.materialNo).toBe('9EDIC1');

    const material = await request(http)
      .get('/api/v1/dic/search?q=9EDIC3&field=material')
      .set(auth(agentToken))
      .expect(200);
    expect(material.body.items).toHaveLength(1);

    const wildcard = await request(http)
      .get(`/api/v1/dic/search?q=${encodeURIComponent('Pana*Extra*')}`)
      .set(auth(agentToken))
      .expect(200);
    expect((wildcard.body.items as { materialNo: string }[]).map((d) => d.materialNo)).toEqual([
      '9EDIC2',
    ]);

    const complete = await request(http)
      .get('/api/v1/dic/search?q=a&limit=2')
      .set(auth(agentToken))
      .expect(200);
    expect(complete.body.items.length).toBeLessThanOrEqual(2);
  });

  it('DI-4 §15.2 drug card: coverage, alternatives, cross-sell, availability', async () => {
    const res = await request(http)
      .get(`/api/v1/dic/drugs/${drugId}`)
      .set(auth(agentToken))
      .expect(200);
    const coverage = res.body.coverages as { companyKey: string; covered: boolean }[];
    expect(coverage.find((c) => c.companyKey === 'MEENA')?.covered).toBe(true);
    expect(res.body.alternatives[0].drug.materialNo).toBe('9EDIC2');
    expect(res.body.crossSells[0].drug.materialNo).toBe('9EDIC3');
    expect(res.body.availability).toEqual({ Jeddah: 12, Riyadh: 3 });
  });

  it('DI-5 §15.3 coverage bulk import per company; unknown rows rejected', async () => {
    await request(http)
      .post('/api/v1/dic/coverage/import')
      .set(auth(managerToken))
      .send({ companyKey: 'NOPE', rows: [{ material: '9EDIC1', covered: true }] })
      .expect(400);

    const res = await request(http)
      .post('/api/v1/dic/coverage/import')
      .set(auth(managerToken))
      .send({
        companyKey: 'BUPA',
        rows: [
          { material: '9EDIC1', covered: true },
          { material: '9EDIC2', covered: false },
          { material: 'GHOST', covered: true },
        ],
      })
      .expect(200);
    expect(res.body.applied).toBe(2);
    expect(res.body.rejected).toHaveLength(1);

    const bupa = await prisma.drugCoverage.findMany({ where: { companyKey: 'BUPA' } });
    expect(bupa.find((c) => c.drugId === drugId)?.covered).toBe(true);
  });

  it('DI-6 change requests accept only editable fields (H5/H8)', async () => {
    await request(http)
      .post(`/api/v1/dic/drugs/${drugId}/change-request`)
      .set(auth(agentToken))
      .send({ patch: { price: 99 } })
      .expect(400);

    const res = await request(http)
      .post(`/api/v1/dic/drugs/${drugId}/change-request`)
      .set(auth(agentToken))
      .send({
        patch: {
          activeIngredient: 'Paracetamol 500mg',
          usage: 'Pain relief, up to 4g/day',
          coverage: { companyKey: 'BUPA', covered: false },
        },
      })
      .expect(201);
    requestId = res.body.id;
    expect(res.body.status).toBe('PENDING');

    // Master unchanged while pending.
    const drug = await prisma.drug.findUniqueOrThrow({ where: { id: drugId } });
    expect(drug.activeIngredient).toBeNull();
  });

  it('DI-7 approvals are gated by dic.approve; agents get 403', async () => {
    await request(http).get('/api/v1/dic/change-requests').set(auth(agentToken)).expect(403);
    await request(http)
      .post(`/api/v1/dic/change-requests/${requestId}/decide`)
      .set(auth(agentToken))
      .send({ decision: 'approve' })
      .expect(403);
  });

  it('DI-8 approving applies the patch atomically (§15.3)', async () => {
    const queue = await request(http)
      .get('/api/v1/dic/change-requests')
      .set(auth(managerToken))
      .expect(200);
    expect((queue.body as { id: string }[]).map((r) => r.id)).toContain(requestId);

    await request(http)
      .post(`/api/v1/dic/change-requests/${requestId}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'approve', note: 'verified against SFDA leaflet' })
      .expect(200);

    const drug = await prisma.drug.findUniqueOrThrow({ where: { id: drugId } });
    expect(drug.activeIngredient).toBe('Paracetamol 500mg');
    expect(drug.usage).toBe('Pain relief, up to 4g/day');
    const bupa = await prisma.drugCoverage.findUniqueOrThrow({
      where: { drugId_companyKey: { drugId, companyKey: 'BUPA' } },
    });
    expect(bupa.covered).toBe(false);

    // Ingredient search works now (§15.1 Active Ingredient).
    const search = await request(http)
      .get('/api/v1/dic/search?q=Paracetamol&field=ingredient')
      .set(auth(agentToken))
      .expect(200);
    expect((search.body.items as { id: string }[]).map((d) => d.id)).toContain(drugId);

    // Deciding twice is blocked.
    await request(http)
      .post(`/api/v1/dic/change-requests/${requestId}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'reject' })
      .expect(422);
  });

  it('DI-9 rejection leaves the master untouched', async () => {
    const created = await request(http)
      .post(`/api/v1/dic/drugs/${drugId}/change-request`)
      .set(auth(agentToken))
      .send({ patch: { offers: 'Buy 2 get 1' } })
      .expect(201);
    await request(http)
      .post(`/api/v1/dic/change-requests/${created.body.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'reject', note: 'no active promotion' })
      .expect(200);
    const drug = await prisma.drug.findUniqueOrThrow({ where: { id: drugId } });
    expect(drug.offers).toBeNull();
  });
});
