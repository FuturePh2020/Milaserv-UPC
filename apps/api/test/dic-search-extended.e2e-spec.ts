import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'DicSearch#12345';
const TAG = 'e2e-dic-search';

/**
 * CR-002 Phase 4 — DIC Drug Master & Normalization Foundation: the
 * extended search (barcode/scientific/alias fields, match source) and
 * the extended drug-details response (ingredients, strength, packaging,
 * aliases, therapeutic classes, dosage form, manufacturer, approved
 * alternatives). Distinct from dic.e2e-spec.ts (Sprint P9's feed-based
 * search, unaffected).
 */
describe('DIC Extended Search & Drug Details (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let agentToken: string;
  let drugId: string;
  let altDrugId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9EDICSEARCH' } } });
    await prisma.dosageForm.deleteMany({ where: { code: 'E2ESEARCH_TABLET' } });
    await prisma.manufacturer.deleteMany({ where: { nameEn: 'E2E Search Pharma Co' } });
    await prisma.activeIngredient.deleteMany({
      where: { scientificNameEn: 'E2E Search Paracetamol' },
    });
    await prisma.therapeuticClass.deleteMany({ where: { code: 'E2ESEARCH_CLASS' } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    await prisma.user.create({
      data: {
        email: `agent.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: 'Search Agent',
        roles: { create: { role: { connect: { key: 'AGENT' } } } },
      },
    });
    agentToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .send({ email: `agent.${TAG}@milaserv360.test`, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;

    // Reference data this drug links to.
    const dosageForm = await prisma.dosageForm.create({
      data: {
        code: 'E2ESEARCH_TABLET',
        nameEn: 'Search Tablet',
        nameAr: 'قرص بحث',
        normalizedNameEn: 'search tablet',
        normalizedNameAr: 'قرص بحث',
      },
    });
    const manufacturer = await prisma.manufacturer.create({
      data: {
        nameEn: 'E2E Search Pharma Co',
        normalizedNameEn: 'e2e search pharma co',
      },
    });
    const ingredient = await prisma.activeIngredient.create({
      data: {
        scientificNameEn: 'E2E Search Paracetamol',
        normalizedScientificNameEn: 'e2e search paracetamol',
        searchNameEn: 'e2e search paracetamol',
      },
    });
    const therapeuticClass = await prisma.therapeuticClass.create({
      data: { code: 'E2ESEARCH_CLASS', nameEn: 'Search Analgesics', nameAr: 'مسكنات بحث' },
    });

    const drug = await prisma.drug.create({
      data: {
        materialNo: '9EDICSEARCH1',
        nameEn: 'SearchoPanol Extra',
        nameAr: 'سيركوبانول اكسترا',
        barcode: '6281099887766',
        dosageFormId: dosageForm.id,
        manufacturerId: manufacturer.id,
        strengthText: '500 mg',
        ingredients: {
          create: { activeIngredientId: ingredient.id, ingredientStrength: '500 mg' },
        },
        aliases: {
          create: {
            alias: 'Searcho Panol',
            normalizedAlias: 'searcho panol',
            language: 'en',
            aliasType: 'COMMON_MISSPELLING',
            source: 'MANUAL',
          },
        },
        packages: { create: { packageType: 'BOX', packagingDescriptionEn: '20 tablets' } },
        therapeuticClasses: { create: { therapeuticClassId: therapeuticClass.id, primary: true } },
      },
    });
    drugId = drug.id;

    const altDrug = await prisma.drug.create({
      data: { materialNo: '9EDICSEARCH2', nameEn: 'SearchoPanol Generic' },
    });
    altDrugId = altDrug.id;
    await prisma.drugAlternativeLink.create({
      data: {
        sourceDrugId: drugId,
        alternativeDrugId: altDrugId,
        alternativeType: 'GENERIC_ALTERNATIVE',
        pharmacistApproved: true,
      },
    });
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('ES-1 barcode field search finds the drug by its barcode', async () => {
    const res = await request(http)
      .get('/api/v1/dic/search?q=6281099887766&field=barcode')
      .set(auth(agentToken))
      .expect(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toContain(drugId);
    expect(res.body.items[0].matchSource).toBe('primary');
  });

  it("ES-2 'all' field search also matches on barcode", async () => {
    const res = await request(http)
      .get('/api/v1/dic/search?q=6281099887766')
      .set(auth(agentToken))
      .expect(200);
    expect(res.body.items.map((i: { id: string }) => i.id)).toContain(drugId);
  });

  it('ES-3 alias field search finds the drug and tags matchSource', async () => {
    const res = await request(http)
      .get('/api/v1/dic/search?q=Searcho Panol&field=alias')
      .set(auth(agentToken))
      .expect(200);
    const match = res.body.items.find((i: { id: string }) => i.id === drugId);
    expect(match).toBeDefined();
    expect(match.matchSource).toBe('alias');
  });

  it('ES-4 scientific field search finds the drug via its linked active ingredient', async () => {
    const res = await request(http)
      .get('/api/v1/dic/search?q=E2E Search Paracetamol&field=scientific')
      .set(auth(agentToken))
      .expect(200);
    const match = res.body.items.find((i: { id: string }) => i.id === drugId);
    expect(match).toBeDefined();
    expect(match.matchSource).toBe('scientific');
  });

  it("ES-5 'all' field search surfaces an alias-only match that the name fields would miss", async () => {
    // "Searcho Panol" (the alias, with a space) doesn't literally
    // appear in nameEn ("SearchoPanol Extra", no space) — this only
    // matches through the alias relation.
    const res = await request(http)
      .get('/api/v1/dic/search?q=Searcho Panol')
      .set(auth(agentToken))
      .expect(200);
    const match = res.body.items.find((i: { id: string }) => i.id === drugId);
    expect(match).toBeDefined();
    expect(match.matchSource).toBe('alias');
  });

  it('ES-6 drug details include every Phase 4 relation', async () => {
    const res = await request(http)
      .get(`/api/v1/dic/drugs/${drugId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(res.body.dosageForm.code).toBe('E2ESEARCH_TABLET');
    expect(res.body.manufacturer.nameEn).toBe('E2E Search Pharma Co');
    expect(res.body.ingredients).toHaveLength(1);
    expect(res.body.ingredients[0].activeIngredient.scientificNameEn).toBe(
      'E2E Search Paracetamol',
    );
    expect(res.body.aliases).toHaveLength(1);
    expect(res.body.aliases[0].alias).toBe('Searcho Panol');
    expect(res.body.aliases[0].approved).toBe(false); // never auto-authoritative
    expect(res.body.packages).toHaveLength(1);
    expect(res.body.therapeuticClasses).toHaveLength(1);
    expect(res.body.therapeuticClasses[0].therapeuticClass.code).toBe('E2ESEARCH_CLASS');
    expect(res.body.dataQualityStatus).toBe('NEEDS_REVIEW'); // Phase 4 default for existing-shaped rows
    expect(res.body.version).toBe(0);
  });

  it('ES-7 drug details surface only pharmacist-approved alternative links', async () => {
    const res = await request(http)
      .get(`/api/v1/dic/drugs/${drugId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(res.body.approvedAlternatives).toHaveLength(1);
    expect(res.body.approvedAlternatives[0].alternativeDrug.id).toBe(altDrugId);
    expect(res.body.approvedAlternatives[0].pharmacistApproved).toBe(true);
    // The raw relation name is never exposed — approvedAlternatives is
    // the only surface for this data.
    expect(res.body.alternativeLinksFrom).toBeUndefined();
  });
});
