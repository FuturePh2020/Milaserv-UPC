import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { DrugMatchingEngine } from '../src/modules/prescriptions/matching/drug-matching.engine';
import { normalizeSearchInput } from '../src/modules/dic/normalization';

const prisma = new PrismaClient();
const TAG = '9EMATCHREVIEW';
const PASSWORD = 'DrugMatchReview#12345';

/**
 * CR-001 Phase 5 — the pharmacist review HTTP API (design summary §21-
 * 23): GET drug-matches(+runId), reprocess, confirm/reject a candidate,
 * manually select a drug, and mark a line as not a medication. Every
 * mutating route requires ocr.review (AGENT only has ocr.view).
 */
describe('Prescriptions — Drug Match Review API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let engine: DrugMatchingEngine;
  let agentToken: string;
  let managerToken: string;
  let uploaderId: string;
  let matchedDrugId: string;
  let altDrugId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: TAG } } });
    await prisma.prescription.deleteMany({ where: { note: { contains: TAG } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG.toLowerCase() } } });
  }

  async function seedPrescriptionWithMatch() {
    const rx = await prisma.prescription.create({
      data: {
        number: `PRX-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
    const rawText = `${TAG} MatchedDrug 500 mg`;
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
    await prisma.prescriptionPage.update({
      where: { id: page.id },
      data: { currentOcrRunId: ocrRun.id },
    });
    const run = await engine.run(rx.id);
    const line = await prisma.prescriptionMedicationLine.findFirstOrThrow({
      where: { prescriptionId: rx.id },
    });
    const candidate = await prisma.prescriptionDrugCandidate.findFirstOrThrow({
      where: { medicationLineId: line.id },
      orderBy: { rank: 'asc' },
    });
    return { prescriptionId: rx.id, runId: run!.id, lineId: line.id, candidateId: candidate.id };
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    engine = app.get(DrugMatchingEngine);
    await cleanup();

    const dept = await prisma.department.upsert({
      where: { code: `${TAG}DEPT` },
      update: {},
      create: { code: `${TAG}DEPT`, nameAr: 'قسم', nameEn: `${TAG} Dept` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق', nameEn: `${TAG} Team`, departmentId: dept.id },
    });
    const agent = await prisma.user.create({
      data: {
        email: `agent.${TAG.toLowerCase()}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: 'Review Agent',
        departmentId: dept.id,
        roles: { create: { role: { connect: { key: 'AGENT' } } } },
        teams: { create: { teamId: team.id } },
      },
    });
    const manager = await prisma.user.create({
      data: {
        email: `manager.${TAG.toLowerCase()}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مدير',
        nameEn: 'Review Manager',
        departmentId: dept.id,
        roles: { create: { role: { connect: { key: 'TEAM_MANAGER' } } } },
        teams: { create: { teamId: team.id } },
      },
    });
    uploaderId = manager.id;

    agentToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .send({ email: agent.email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;
    managerToken = (
      await request(http)
        .post('/api/v1/auth/login')
        .send({ email: manager.email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;

    const tabletForm = await prisma.dosageForm.findUniqueOrThrow({ where: { code: 'TABLET' } });
    const mgUnit = await prisma.measurementUnit.findUniqueOrThrow({ where: { code: 'mg' } });

    const matchedName = `${TAG} MatchedDrug`;
    const matchedDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}1`,
        nameEn: matchedName,
        normalizedTradeNameEnglish: normalizeSearchInput(matchedName),
        searchNameEnglish: normalizeSearchInput(matchedName),
        combinedSearchText: normalizeSearchInput(matchedName),
        dosageFormId: tabletForm.id,
        strengthText: '500 mg',
        dataQualityStatus: 'VERIFIED',
        active: true,
        strengthComponents: {
          create: {
            numeratorValue: 500,
            numeratorUnitId: mgUnit.id,
            originalStrengthText: '500 mg',
          },
        },
      },
    });
    matchedDrugId = matchedDrug.id;

    const altName = `${TAG} AlternativeDrug`;
    const altDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}2`,
        nameEn: altName,
        normalizedTradeNameEnglish: normalizeSearchInput(altName),
        active: true,
        dataQualityStatus: 'VERIFIED',
      },
    });
    altDrugId = altDrug.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('REV-1 GET drug-matches returns the latest run with scored candidates', async () => {
    const { prescriptionId } = await seedPrescriptionWithMatch();
    const res = await request(http)
      .get(`/api/v1/prescriptions/${prescriptionId}/drug-matches`)
      .set(auth(agentToken))
      .expect(200);
    expect(res.body.run.prescriptionId).toBe(prescriptionId);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].candidates.length).toBeGreaterThanOrEqual(1);
    expect(res.body.lines[0].candidates[0].matchedDrug.id).toBe(matchedDrugId);
  });

  it('REV-2 GET drug-matches rejects an unauthenticated request', async () => {
    const { prescriptionId } = await seedPrescriptionWithMatch();
    await request(http).get(`/api/v1/prescriptions/${prescriptionId}/drug-matches`).expect(401);
  });

  it('REV-3 GET drug-matches/runs lists every run, and ?runId fetches a specific historical one', async () => {
    const { prescriptionId, runId: firstRunId } = await seedPrescriptionWithMatch();
    await request(http)
      .post(`/api/v1/prescriptions/${prescriptionId}/drug-matches/reprocess`)
      .set(auth(managerToken))
      .expect(200);

    const runs = await request(http)
      .get(`/api/v1/prescriptions/${prescriptionId}/drug-matches/runs`)
      .set(auth(agentToken))
      .expect(200);
    expect(runs.body).toHaveLength(2);

    const historical = await request(http)
      .get(`/api/v1/prescriptions/${prescriptionId}/drug-matches?runId=${firstRunId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(historical.body.run.id).toBe(firstRunId);
  });

  it('REV-4 reprocess requires ocr.review — an agent (view-only) is forbidden', async () => {
    const { prescriptionId } = await seedPrescriptionWithMatch();
    await request(http)
      .post(`/api/v1/prescriptions/${prescriptionId}/drug-matches/reprocess`)
      .set(auth(agentToken))
      .expect(403);
  });

  it('REV-5 confirming a candidate selects the drug, clears reviewRequired, and records a decision', async () => {
    const { prescriptionId, lineId, candidateId } = await seedPrescriptionWithMatch();
    const res = await request(http)
      .post(
        `/api/v1/prescriptions/${prescriptionId}/medication-lines/${lineId}/candidates/${candidateId}/confirm`,
      )
      .set(auth(managerToken))
      .expect(200);
    expect(res.body.matchingStatus).toBe('CONFIRMED');
    expect(res.body.reviewRequired).toBe(false);
    expect(res.body.selectedDrugId).toBe(matchedDrugId);

    const decisions = await prisma.drugMatchDecision.findMany({
      where: { medicationLineId: lineId },
    });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]!.decisionType).toBe('CANDIDATE_CONFIRMED');

    const candidate = await prisma.prescriptionDrugCandidate.findUniqueOrThrow({
      where: { id: candidateId },
    });
    expect(candidate.selected).toBe(true);
  });

  it('REV-6 confirm requires ocr.review', async () => {
    const { prescriptionId, lineId, candidateId } = await seedPrescriptionWithMatch();
    await request(http)
      .post(
        `/api/v1/prescriptions/${prescriptionId}/medication-lines/${lineId}/candidates/${candidateId}/confirm`,
      )
      .set(auth(agentToken))
      .expect(403);
  });

  it('REV-7 rejecting a candidate flags it without changing the line status', async () => {
    const { prescriptionId, lineId, candidateId } = await seedPrescriptionWithMatch();
    const lineBefore = await prisma.prescriptionMedicationLine.findUniqueOrThrow({
      where: { id: lineId },
    });
    await request(http)
      .post(
        `/api/v1/prescriptions/${prescriptionId}/medication-lines/${lineId}/candidates/${candidateId}/reject`,
      )
      .set(auth(managerToken))
      .send({ reason: 'wrong strength' })
      .expect(200);

    const candidate = await prisma.prescriptionDrugCandidate.findUniqueOrThrow({
      where: { id: candidateId },
    });
    expect(candidate.rejected).toBe(true);
    const lineAfter = await prisma.prescriptionMedicationLine.findUniqueOrThrow({
      where: { id: lineId },
    });
    expect(lineAfter.matchingStatus).toBe(lineBefore.matchingStatus);
    expect(lineAfter.reviewRequired).toBe(true);

    const decisions = await prisma.drugMatchDecision.findMany({
      where: { medicationLineId: lineId },
    });
    expect(decisions[0]!.decisionType).toBe('CANDIDATE_REJECTED');
    expect(decisions[0]!.notes).toBe('wrong strength');
  });

  it('REV-8 a candidate that does not belong to the line returns 404', async () => {
    const first = await seedPrescriptionWithMatch();
    const second = await seedPrescriptionWithMatch();
    await request(http)
      .post(
        `/api/v1/prescriptions/${first.prescriptionId}/medication-lines/${first.lineId}/candidates/${second.candidateId}/confirm`,
      )
      .set(auth(managerToken))
      .expect(404);
  });

  it('REV-9 manually selecting a drug bypasses the candidate list entirely', async () => {
    const { prescriptionId, lineId } = await seedPrescriptionWithMatch();
    const res = await request(http)
      .post(`/api/v1/prescriptions/${prescriptionId}/medication-lines/${lineId}/select-drug`)
      .set(auth(managerToken))
      .send({ drugId: altDrugId, reason: 'pharmacist knows better' })
      .expect(200);
    expect(res.body.matchingStatus).toBe('MANUALLY_SELECTED');
    expect(res.body.selectedDrugId).toBe(altDrugId);
    expect(res.body.selectedCandidateId).toBeNull();
    expect(res.body.reviewRequired).toBe(false);

    const decisions = await prisma.drugMatchDecision.findMany({
      where: { medicationLineId: lineId },
    });
    expect(decisions[0]!.decisionType).toBe('MANUAL_DRUG_SELECTED');
  });

  it('REV-10 select-drug rejects an unknown drugId', async () => {
    const { prescriptionId, lineId } = await seedPrescriptionWithMatch();
    await request(http)
      .post(`/api/v1/prescriptions/${prescriptionId}/medication-lines/${lineId}/select-drug`)
      .set(auth(managerToken))
      .send({ drugId: 'not-a-real-drug-id' })
      .expect(400);
  });

  it('REV-11 marking a line as not-a-medication clears any selection and requires no further review', async () => {
    const { prescriptionId, lineId } = await seedPrescriptionWithMatch();
    const res = await request(http)
      .post(
        `/api/v1/prescriptions/${prescriptionId}/medication-lines/${lineId}/mark-not-medication`,
      )
      .set(auth(managerToken))
      .send({ reason: 'this is a dosage instruction, not a drug' })
      .expect(200);
    expect(res.body.matchingStatus).toBe('NOT_A_MEDICATION');
    expect(res.body.selectedDrugId).toBeNull();
    expect(res.body.reviewRequired).toBe(false);

    const decisions = await prisma.drugMatchDecision.findMany({
      where: { medicationLineId: lineId },
    });
    expect(decisions[0]!.decisionType).toBe('NON_MEDICATION_LINE');
  });

  it('REV-12 a medication line from a different prescription returns 404', async () => {
    const first = await seedPrescriptionWithMatch();
    const second = await seedPrescriptionWithMatch();
    await request(http)
      .post(
        `/api/v1/prescriptions/${first.prescriptionId}/medication-lines/${second.lineId}/mark-not-medication`,
      )
      .set(auth(managerToken))
      .expect(404);
  });
});
