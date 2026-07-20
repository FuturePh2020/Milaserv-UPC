import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { DrugMatchingEngine } from '../src/modules/prescriptions/matching/drug-matching.engine';
import { INVENTORY_PROVIDER } from '../src/modules/inventory/inventory-provider.interface';
import type { InventoryProvider } from '../src/modules/inventory/inventory-provider.interface';
import { computeAvailableQuantity } from '../src/modules/inventory/inventory-calculations';
import { normalizeSearchInput } from '../src/modules/dic/normalization';

const prisma = new PrismaClient();
const TAG = '9EFULFILLAPI';
const PASSWORD = 'FulfillApi#12345';

function fixtureDrugData(materialNo: string, nameEn: string, extra: Partial<Prisma.DrugCreateInput> = {}) {
  return {
    materialNo,
    nameEn,
    active: true,
    normalizedTradeNameEnglish: normalizeSearchInput(nameEn),
    searchNameEnglish: normalizeSearchInput(nameEn),
    combinedSearchText: normalizeSearchInput(nameEn),
    ...extra,
  };
}

/**
 * Phase 6 Step 6 — the fulfillment HTTP API: search-location creation,
 * request creation, plan generation/listing, and the one authorized
 * "confirm a plan" action that creates InventoryReservation rows.
 * fulfillment.select_plan is deliberately not granted to AGENT — that
 * confirm action needs a higher-trust role, same tier as ticket.resolve.
 */
describe('Fulfillment API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let engine: DrugMatchingEngine;
  let inventoryProvider: InventoryProvider;
  let adminToken: string;
  let agentToken: string;
  let readOnlyToken: string;
  let uploaderId: string;
  let regionId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.inventoryReservation.deleteMany({
      where: { fulfillmentPlan: { fulfillmentRequest: { prescription: { note: { contains: TAG } } } } },
    });
    await prisma.fulfillmentPlanItem.deleteMany({
      where: { fulfillmentPlanBranch: { fulfillmentPlan: { fulfillmentRequest: { prescription: { note: { contains: TAG } } } } } },
    });
    await prisma.fulfillmentPlanBranch.deleteMany({
      where: { fulfillmentPlan: { fulfillmentRequest: { prescription: { note: { contains: TAG } } } } },
    });
    await prisma.fulfillmentPlan.deleteMany({ where: { fulfillmentRequest: { prescription: { note: { contains: TAG } } } } });
    await prisma.fulfillmentRequestItem.deleteMany({
      where: { fulfillmentRequest: { prescription: { note: { contains: TAG } } } },
    });
    await prisma.fulfillmentRequest.deleteMany({ where: { prescription: { note: { contains: TAG } } } });
    await prisma.searchLocation.deleteMany({ where: { addressText: { contains: TAG } } });
    await prisma.branch.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: TAG } } });
    await prisma.prescription.deleteMany({ where: { note: { contains: TAG } } });
    await prisma.city.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.region.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG.toLowerCase() } } });
  }

  async function seedConfirmedLine(drugId: string) {
    const drug = await prisma.drug.findUniqueOrThrow({ where: { id: drugId } });
    const rx = await prisma.prescription.create({
      data: {
        number: `PRX-${TAG}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'EXTRACTING',
        uploadedById: uploaderId,
        note: `${TAG} fixture`,
      },
    });
    const page = await prisma.prescriptionPage.create({
      data: { prescriptionId: rx.id, pageNumber: 1, originalStorageKey: `${TAG}/${rx.id}.jpg`, processingStatus: 'COMPLETED' },
    });
    const ocrRun = await prisma.prescriptionOcrRun.create({
      data: {
        prescriptionPageId: page.id,
        runNumber: 1,
        providerName: 'test-fixture',
        trigger: 'initial',
        settingsSnapshotJson: {},
        status: 'COMPLETED',
      },
    });
    const rawText = `${drug.nameEn} 500 mg`;
    await prisma.oCRTextBlock.create({
      data: {
        prescriptionPageId: page.id,
        ocrRunId: ocrRun.id,
        rawText,
        normalizedText: normalizeSearchInput(rawText),
        language: 'en',
        ocrConfidence: 0.95,
        lineNumber: 0,
        blockIndex: 0,
      },
    });
    await prisma.prescriptionPage.update({ where: { id: page.id }, data: { currentOcrRunId: ocrRun.id } });
    await engine.run(rx.id);
    const line = await prisma.prescriptionMedicationLine.findFirstOrThrow({ where: { prescriptionId: rx.id } });
    const candidate = await prisma.prescriptionDrugCandidate.findFirstOrThrow({
      where: { medicationLineId: line.id },
      orderBy: { rank: 'asc' },
    });
    const confirmedLine = await prisma.prescriptionMedicationLine.update({
      where: { id: line.id },
      data: {
        matchingStatus: 'CONFIRMED',
        selectedDrugId: drugId,
        selectedCandidateId: candidate.id,
        reviewRequired: false,
      },
    });
    return { prescriptionId: rx.id, lineId: confirmedLine.id };
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    engine = app.get(DrugMatchingEngine);
    inventoryProvider = app.get(INVENTORY_PROVIDER);
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
    const admin = await mk(`admin.${TAG.toLowerCase()}@milaserv360.test`, 'SUPER_ADMIN');
    await mk(`agent.${TAG.toLowerCase()}@milaserv360.test`, 'AGENT');
    await mk(`ro.${TAG.toLowerCase()}@milaserv360.test`, 'READ_ONLY');
    uploaderId = admin.id;

    const login = async (email: string) =>
      (
        await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200)
      ).body.accessToken as string;
    adminToken = await login(`admin.${TAG.toLowerCase()}@milaserv360.test`);
    agentToken = await login(`agent.${TAG.toLowerCase()}@milaserv360.test`);
    readOnlyToken = await login(`ro.${TAG.toLowerCase()}@milaserv360.test`);

    const region = await prisma.region.create({
      data: { code: `${TAG}-R1`, nameEn: 'Test Region', nameAr: 'منطقة اختبار' },
    });
    regionId = region.id;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  let citySuffix = 0;
  async function makeCity(): Promise<string> {
    citySuffix++;
    const city = await prisma.city.create({
      data: {
        code: `${TAG}-C${citySuffix}`,
        regionId,
        nameEn: `Fulfillment API Test City ${citySuffix}`,
        nameAr: `مدينة اختبار API ${citySuffix}`,
        normalizedNameEn: `fulfillment api test city ${citySuffix}`,
        normalizedNameAr: `مدينة اختبار api ${citySuffix}`,
        latitude: 24.7,
        longitude: 46.7,
      },
    });
    return city.id;
  }

  it('FA-1 a user without fulfillment.request cannot create a search location', async () => {
    await request(http)
      .post('/api/v1/fulfillment/search-locations')
      .set(auth(readOnlyToken))
      .send({ latitude: 24.7, longitude: 46.7, sourceType: 'MAP_PIN', addressText: `${TAG} FA-1` })
      .expect(403);
  });

  it('FA-2 a fulfillment.request holder can create a search location, a request, and generate plans', async () => {
    const cityId = await makeCity();
    const branch = await prisma.branch.create({
      data: {
        code: `${TAG}-B2`,
        nameAr: 'فرع',
        nameEn: 'Branch FA-2',
        locationCityId: cityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
        latitude: 24.7,
        longitude: 46.7,
      },
    });
    const drug = await prisma.drug.create({ data: fixtureDrugData(`${TAG}2`, `${TAG} DrugFA2`) });
    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);

    const locationRes = await request(http)
      .post('/api/v1/fulfillment/search-locations')
      .set(auth(agentToken))
      .send({ cityId, latitude: 24.7, longitude: 46.7, sourceType: 'MAP_PIN', addressText: `${TAG} FA-2` })
      .expect(201);
    const searchLocationId = locationRes.body.id;

    const requestRes = await request(http)
      .post('/api/v1/fulfillment/requests')
      .set(auth(agentToken))
      .send({ prescriptionId, medicationLineIds: [lineId], searchLocationId })
      .expect(201);
    const fulfillmentRequestId = requestRes.body.id;
    expect(requestRes.body.status).toBe('SEARCH_QUEUED');

    // requiredQuantity=0 makes any stock level (even none) satisfy
    // the requirement — see FulfillmentPlanGeneratorService's e2e
    // suite for why this keeps assertions independent of the mock
    // inventory provider's per-branch random seed.
    await prisma.fulfillmentRequestItem.updateMany({
      where: { fulfillmentRequestId },
      data: { requiredQuantity: 0 },
    });

    const genRes = await request(http)
      .post(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/generate-plans`)
      .set(auth(agentToken))
      .expect(201);
    expect(genRes.body).toHaveLength(1);
    expect(genRes.body[0].planType).toBe('SINGLE_BRANCH');
    expect(genRes.body[0].branches[0].branchId).toBe(branch.id);

    const listRes = await request(http)
      .get(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/plans`)
      .set(auth(agentToken))
      .expect(200);
    expect(listRes.body).toHaveLength(1);

    const getRes = await request(http)
      .get(`/api/v1/fulfillment/requests/${fulfillmentRequestId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(getRes.body.plans).toHaveLength(1);
  });

  it('FA-3 an AGENT (no fulfillment.select_plan) cannot select a plan, but a SUPER_ADMIN can — creating reservations', async () => {
    const cityId = await makeCity();
    const branch = await prisma.branch.create({
      data: {
        code: `${TAG}-B3`,
        nameAr: 'فرع',
        nameEn: 'Branch FA-3',
        locationCityId: cityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
        latitude: 24.7,
        longitude: 46.7,
      },
    });
    const drug = await prisma.drug.create({ data: fixtureDrugData(`${TAG}3`, `${TAG} DrugFA3`) });
    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);
    const locationRes = await request(http)
      .post('/api/v1/fulfillment/search-locations')
      .set(auth(agentToken))
      .send({ cityId, latitude: 24.7, longitude: 46.7, sourceType: 'MAP_PIN', addressText: `${TAG} FA-3` })
      .expect(201);
    const requestRes = await request(http)
      .post('/api/v1/fulfillment/requests')
      .set(auth(agentToken))
      .send({ prescriptionId, medicationLineIds: [lineId], searchLocationId: locationRes.body.id })
      .expect(201);
    const fulfillmentRequestId = requestRes.body.id;
    // Setting requiredQuantity to the branch's own real (mock-provider)
    // available stock — not 0 — so the plan generator actually
    // allocates a positive quantity; a zero requirement is trivially
    // "available" but allocates nothing, which would starve the
    // reservation step below of anything to reserve.
    const rows = await inventoryProvider.getBranchInventory(branch.id, [drug.id]);
    const available =
      computeAvailableQuantity(
        rows[0]?.onHandQuantity ?? null,
        rows[0]?.reservedQuantity ?? null,
        rows[0]?.blockedQuantity ?? null,
        rows[0]?.damagedQuantity ?? null,
      ) ?? 0;
    await prisma.fulfillmentRequestItem.updateMany({
      where: { fulfillmentRequestId },
      data: { requiredQuantity: available > 0 ? available : null },
    });
    const genRes = await request(http)
      .post(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/generate-plans`)
      .set(auth(agentToken))
      .expect(201);
    const planId = genRes.body[0].id;

    await request(http)
      .post(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/plans/${planId}/select`)
      .set(auth(agentToken))
      .expect(403);

    const selectRes = await request(http)
      .post(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/plans/${planId}/select`)
      .set(auth(adminToken))
      .expect(201);
    expect(selectRes.body.selected).toBe(true);
    expect(selectRes.body.reservations.length).toBeGreaterThan(0);
    expect(selectRes.body.reservations.every((r: { status: string }) => r.status === 'PENDING')).toBe(true);
    expect(selectRes.body.reservations.every((r: { branchId: string }) => r.branchId === branch.id)).toBe(true);

    const updatedRequest = await prisma.fulfillmentRequest.findUniqueOrThrow({ where: { id: fulfillmentRequestId } });
    expect(updatedRequest.status).toBe('PLAN_SELECTED');

    // Re-selecting the same plan is idempotent, not an error.
    await request(http)
      .post(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/plans/${planId}/select`)
      .set(auth(adminToken))
      .expect(201);
    const reservationCount = await prisma.inventoryReservation.count({ where: { fulfillmentPlanId: planId } });
    expect(reservationCount).toBe(selectRes.body.reservations.length);
  });

  it('FA-4 a request with no eligible branch produces a NO_SAFE_PLAN that cannot be selected', async () => {
    const drug = await prisma.drug.create({ data: fixtureDrugData(`${TAG}4`, `${TAG} DrugFA4`) });
    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);
    const cityId = await makeCity(); // no branches created in this city
    const locationRes = await request(http)
      .post('/api/v1/fulfillment/search-locations')
      .set(auth(agentToken))
      .send({ cityId, latitude: 24.7, longitude: 46.7, sourceType: 'MAP_PIN', addressText: `${TAG} FA-4` })
      .expect(201);
    const requestRes = await request(http)
      .post('/api/v1/fulfillment/requests')
      .set(auth(agentToken))
      .send({ prescriptionId, medicationLineIds: [lineId], searchLocationId: locationRes.body.id })
      .expect(201);
    const fulfillmentRequestId = requestRes.body.id;

    const genRes = await request(http)
      .post(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/generate-plans`)
      .set(auth(agentToken))
      .expect(201);
    expect(genRes.body[0].planType).toBe('NO_SAFE_PLAN');

    await request(http)
      .post(`/api/v1/fulfillment/requests/${fulfillmentRequestId}/plans/${genRes.body[0].id}/select`)
      .set(auth(adminToken))
      .expect(400);
  });
});
