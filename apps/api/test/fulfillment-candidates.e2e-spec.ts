import type { INestApplication } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './setup';
import { DrugMatchingEngine } from '../src/modules/prescriptions/matching/drug-matching.engine';
import { FulfillmentRequestService } from '../src/modules/fulfillment/fulfillment-request.service';
import { BranchCandidateGeneratorService } from '../src/modules/fulfillment/branch-candidate-generator.service';
import { normalizeSearchInput } from '../src/modules/dic/normalization';

const prisma = new PrismaClient();
const TAG = '9EFULFILL4';

/** Fixture drugs must populate the same normalized/search fields the
 *  real matching engine's candidate generator queries against
 *  (normalizedTradeNameEnglish / searchNameEnglish / combinedSearchText)
 *  — nameEn alone is never enough, mirroring Phase 5's own fixture
 *  convention (prescriptions-drug-match-review.e2e-spec.ts). */
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
 * Phase 6 Step 4 — FulfillmentRequestService (only pharmacist-confirmed
 * lines may enter) and BranchCandidateGeneratorService (Stages 1-3:
 * city filter, serviceability, operational eligibility).
 */
describe('Fulfillment Candidate Generation Stages 1-3 (e2e)', () => {
  let app: INestApplication;
  let engine: DrugMatchingEngine;
  let requestService: FulfillmentRequestService;
  let candidateGenerator: BranchCandidateGeneratorService;
  let uploaderId: string;
  let regionId: string;
  let cityId: string;
  let otherCityId: string;

  async function cleanup() {
    await prisma.fulfillmentRequestItem.deleteMany({
      where: { fulfillmentRequest: { prescription: { note: { contains: TAG } } } },
    });
    await prisma.fulfillmentRequest.deleteMany({ where: { prescription: { note: { contains: TAG } } } });
    await prisma.searchLocation.deleteMany({ where: { addressText: { contains: TAG } } });
    await prisma.branch.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await prisma.branchCapability.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: TAG } } });
    await prisma.prescription.deleteMany({ where: { note: { contains: TAG } } });
    await prisma.city.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.region.deleteMany({ where: { code: { startsWith: TAG } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG.toLowerCase() } } });
  }

  async function seedConfirmedLine(drugId: string) {
    // Use the drug's own exact name so the real matching engine finds
    // it as an exact-name candidate, regardless of which fixture drug
    // (each with a distinct nameEn) this call is confirming for.
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
      data: {
        prescriptionId: rx.id,
        pageNumber: 1,
        originalStorageKey: `${TAG}/${rx.id}.jpg`,
        processingStatus: 'COMPLETED',
      },
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
    // Directly confirm — bypasses the HTTP review flow, which isn't
    // under test here.
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
    engine = app.get(DrugMatchingEngine);
    requestService = app.get(FulfillmentRequestService);
    candidateGenerator = app.get(BranchCandidateGeneratorService);
    await cleanup();

    const uploader = await prisma.user.create({
      data: {
        email: `uploader.${TAG.toLowerCase()}@milaserv360.test`,
        passwordHash: 'x',
        nameAr: 'رافع',
        nameEn: `Uploader ${TAG}`,
      },
    });
    uploaderId = uploader.id;

    const region = await prisma.region.create({
      data: { code: `${TAG}-R1`, nameEn: 'Test Region', nameAr: 'منطقة اختبار' },
    });
    regionId = region.id;
    const city = await prisma.city.create({
      data: {
        code: `${TAG}-C1`,
        regionId,
        nameEn: 'Fulfillment Test City',
        nameAr: 'مدينة اختبار التلبية',
        normalizedNameEn: 'fulfillment test city',
        normalizedNameAr: 'مدينة اختبار التلبية',
      },
    });
    cityId = city.id;
    const otherCity = await prisma.city.create({
      data: {
        code: `${TAG}-C2`,
        regionId,
        nameEn: 'Other City',
        nameAr: 'مدينة أخرى',
        normalizedNameEn: 'other city',
        normalizedNameAr: 'مدينة أخرى',
      },
    });
    otherCityId = otherCity.id;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('FC-1 an unconfirmed medication line is rejected — fulfillment never routes an OCR guess', async () => {
    const drug = await prisma.drug.create({
      data: fixtureDrugData(`${TAG}1`, `${TAG} MatchedDrug`),
    });
    const rx = await prisma.prescription.create({
      data: { number: `PRX-${TAG}-unconfirmed`, status: 'EXTRACTING', uploadedById: uploaderId, note: `${TAG} fixture` },
    });
    const page = await prisma.prescriptionPage.create({
      data: { prescriptionId: rx.id, pageNumber: 1, originalStorageKey: `${TAG}/x.jpg`, processingStatus: 'COMPLETED' },
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
    await prisma.oCRTextBlock.create({
      data: {
        prescriptionPageId: page.id,
        ocrRunId: ocrRun.id,
        rawText: `${TAG} MatchedDrug`,
        normalizedText: normalizeSearchInput(`${TAG} MatchedDrug`),
        language: 'en',
        ocrConfidence: 0.5,
        lineNumber: 0,
        blockIndex: 0,
      },
    });
    await prisma.prescriptionPage.update({ where: { id: page.id }, data: { currentOcrRunId: ocrRun.id } });
    await engine.run(rx.id);
    const line = await prisma.prescriptionMedicationLine.findFirstOrThrow({ where: { prescriptionId: rx.id } });

    await expect(
      requestService.createRequest({ prescriptionId: rx.id, medicationLineIds: [line.id] }),
    ).rejects.toThrow(/not pharmacist-confirmed/);
  });

  it('FC-2 Stage 1 city filter excludes a branch in a different city entirely', async () => {
    const drug = await prisma.drug.create({
      data: fixtureDrugData(`${TAG}2`, `${TAG} MatchedDrug2`),
    });
    const inCity = await prisma.branch.create({
      data: {
        code: `${TAG}-INCITY`,
        nameAr: 'فرع بالمدينة',
        nameEn: 'In City Branch',
        locationCityId: cityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
      },
    });
    await prisma.branch.create({
      data: {
        code: `${TAG}-OTHERCITY`,
        nameAr: 'فرع مدينة أخرى',
        nameEn: 'Other City Branch',
        locationCityId: otherCityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
      },
    });

    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);
    const location = await requestService.createSearchLocation({ cityId, sourceType: 'MANUAL_CITY', addressText: TAG });
    const fulfillmentRequest = await requestService.createRequest({
      prescriptionId,
      medicationLineIds: [lineId],
      searchLocationId: location.id,
    });
    const result = await candidateGenerator.generate(fulfillmentRequest.id);

    expect(result.eligible.map((c) => c.branchId)).toEqual([inCity.id]);
    // Stage 1's city filter must exclude the other-city branch by never
    // fetching it in the first place — it shouldn't appear anywhere in
    // the result at all, not even as an excluded entry.
    expect(result.eligible.length + result.excluded.length).toBe(1);
  });

  it('FC-3 Stage 2 excludes a same-city branch whose service area does not cover the location', async () => {
    const drug = await prisma.drug.create({
      data: fixtureDrugData(`${TAG}3`, `${TAG} MatchedDrug3`),
    });
    const restrictedBranch = await prisma.branch.create({
      data: {
        code: `${TAG}-RESTRICTED`,
        nameAr: 'فرع مقيد',
        nameEn: 'Restricted Branch',
        locationCityId: cityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
        serviceAreas: {
          create: { serviceAreaType: 'CITY', cityId: otherCityId, deliveryEnabled: true, pickupEnabled: true },
        },
      },
    });

    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);
    const location = await requestService.createSearchLocation({ cityId, sourceType: 'MANUAL_CITY', addressText: TAG });
    const fulfillmentRequest = await requestService.createRequest({
      prescriptionId,
      medicationLineIds: [lineId],
      searchLocationId: location.id,
    });
    const result = await candidateGenerator.generate(fulfillmentRequest.id);

    const excludedEntry = result.excluded.find((c) => c.branchId === restrictedBranch.id);
    expect(excludedEntry).toBeDefined();
    expect(excludedEntry!.exclusionCodes).toContain('OUTSIDE_SERVICE_AREA');
  });

  it('FC-4 Stage 3 excludes an inactive, closed, and prescription-fulfillment-disabled branch with every applicable code', async () => {
    const drug = await prisma.drug.create({
      data: fixtureDrugData(`${TAG}4`, `${TAG} MatchedDrug4`),
    });
    const badBranch = await prisma.branch.create({
      data: {
        code: `${TAG}-BAD`,
        nameAr: 'فرع سيء',
        nameEn: 'Bad Branch',
        locationCityId: cityId,
        status: 'INACTIVE',
        temporarilyClosed: true,
        prescriptionFulfillmentEnabled: false,
      },
    });

    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);
    const location = await requestService.createSearchLocation({ cityId, sourceType: 'MANUAL_CITY', addressText: TAG });
    const fulfillmentRequest = await requestService.createRequest({
      prescriptionId,
      medicationLineIds: [lineId],
      searchLocationId: location.id,
    });
    const result = await candidateGenerator.generate(fulfillmentRequest.id);

    const excludedEntry = result.excluded.find((c) => c.branchId === badBranch.id);
    expect(excludedEntry).toBeDefined();
    expect(excludedEntry!.exclusionCodes).toEqual(
      expect.arrayContaining(['BRANCH_INACTIVE', 'TEMPORARILY_CLOSED', 'PRESCRIPTION_FULFILLMENT_NOT_ENABLED']),
    );
  });

  it('FC-5 Stage 3 excludes a branch missing a required COLD_CHAIN capability, and includes one that has it', async () => {
    const coldDrug = await prisma.drug.create({
      data: fixtureDrugData(`${TAG}5`, `${TAG} ColdDrug`, { coldChain: true }),
    });
    const capability = await prisma.branchCapability.upsert({
      where: { code: 'COLD_CHAIN' },
      update: {},
      create: { code: 'COLD_CHAIN', nameEn: 'Cold Chain', nameAr: 'سلسلة تبريد' },
    });
    const noColdChainBranch = await prisma.branch.create({
      data: {
        code: `${TAG}-NOCOLD`,
        nameAr: 'فرع بلا تبريد',
        nameEn: 'No Cold Chain Branch',
        locationCityId: cityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
      },
    });
    const coldChainBranch = await prisma.branch.create({
      data: {
        code: `${TAG}-COLD`,
        nameAr: 'فرع تبريد',
        nameEn: 'Cold Chain Branch',
        locationCityId: cityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
        capabilityAssignments: { create: { capabilityId: capability.id } },
      },
    });

    const { prescriptionId, lineId } = await seedConfirmedLine(coldDrug.id);
    const location = await requestService.createSearchLocation({ cityId, sourceType: 'MANUAL_CITY', addressText: TAG });
    const fulfillmentRequest = await requestService.createRequest({
      prescriptionId,
      medicationLineIds: [lineId],
      searchLocationId: location.id,
    });
    const result = await candidateGenerator.generate(fulfillmentRequest.id);

    expect(result.eligible.map((c) => c.branchId)).toContain(coldChainBranch.id);
    const excludedEntry = result.excluded.find((c) => c.branchId === noColdChainBranch.id);
    expect(excludedEntry).toBeDefined();
    expect(excludedEntry!.exclusionCodes).toContain('COLD_CHAIN_UNSUPPORTED');
  });

  it('FC-6 a branch with no service areas configured at all is treated as unrestricted, not excluded', async () => {
    const drug = await prisma.drug.create({
      data: fixtureDrugData(`${TAG}6`, `${TAG} MatchedDrug6`),
    });
    const unrestrictedBranch = await prisma.branch.create({
      data: {
        code: `${TAG}-UNRESTRICTED`,
        nameAr: 'فرع غير مقيد',
        nameEn: 'Unrestricted Branch',
        locationCityId: cityId,
        status: 'ACTIVE',
        prescriptionFulfillmentEnabled: true,
      },
    });

    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);
    const location = await requestService.createSearchLocation({ cityId, sourceType: 'MANUAL_CITY', addressText: TAG });
    const fulfillmentRequest = await requestService.createRequest({
      prescriptionId,
      medicationLineIds: [lineId],
      searchLocationId: location.id,
    });
    const result = await candidateGenerator.generate(fulfillmentRequest.id);

    expect(result.eligible.map((c) => c.branchId)).toContain(unrestrictedBranch.id);
  });

  it('FC-7 generating candidates for a request with no search location set is rejected', async () => {
    const drug = await prisma.drug.create({
      data: fixtureDrugData(`${TAG}7`, `${TAG} MatchedDrug7`),
    });
    const { prescriptionId, lineId } = await seedConfirmedLine(drug.id);
    const fulfillmentRequest = await requestService.createRequest({ prescriptionId, medicationLineIds: [lineId] });
    expect(fulfillmentRequest.status).toBe('LOCATION_REQUIRED');

    await expect(candidateGenerator.generate(fulfillmentRequest.id)).rejects.toThrow(/no search location/);
  });
});
