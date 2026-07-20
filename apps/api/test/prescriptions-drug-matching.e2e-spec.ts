import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { createTestApp } from './setup';
import { DrugMatchingEngine } from '../src/modules/prescriptions/matching/drug-matching.engine';
import { normalizeSearchInput } from '../src/modules/dic/normalization';

const prisma = new PrismaClient();
const TAG = '9EMATCHENGINE';
const PASSWORD = 'DrugMatchEngine#12345';

interface FixtureBlock {
  rawText: string;
  normalizedText: string;
  language: string;
  confidence: number;
  lineNumber: number;
}

/**
 * CR-001 Phase 5 — DrugMatchingEngine (design summary §1/§20) exercised
 * end to end against real seeded DIC fixtures and a real OCRTextBlock
 * set, invoked directly via the same DI-wired instance the queue worker
 * uses (bypassing the queue itself for determinism — the queue/worker
 * plumbing is already covered by prescriptions.e2e-spec.ts's PX-4).
 */
describe('DrugMatchingEngine (e2e)', () => {
  let app: INestApplication;
  let engine: DrugMatchingEngine;
  let uploaderId: string;
  let tabletFormId: string;
  let mgUnitId: string;
  let augmentinDrugId: string;
  let discontinuedDrugId: string;

  async function cleanup() {
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: TAG } } });
    await prisma.manufacturer.deleteMany({ where: { nameEn: { startsWith: TAG } } });
    await prisma.activeIngredient.deleteMany({ where: { scientificNameEn: { startsWith: TAG } } });
    await prisma.prescription.deleteMany({ where: { note: { contains: TAG } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG.toLowerCase() } } });
  }

  /** Creates a Prescription + one COMPLETED PrescriptionPage + a real
   *  PrescriptionOcrRun + OCRTextBlock rows, mirroring exactly what the
   *  real OCR pipeline would have left behind by the time
   *  DrugMatchingEngine.run() is triggered — without going through the
   *  full HTTP upload/OCR-stub flow, which prescriptions.e2e-spec.ts
   *  already covers. */
  async function seedPrescription(blocks: FixtureBlock[]): Promise<string> {
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
    if (blocks.length) {
      await prisma.oCRTextBlock.createMany({
        data: blocks.map((b, i) => ({
          prescriptionPageId: page.id,
          ocrRunId: ocrRun.id,
          rawText: b.rawText,
          normalizedText: b.normalizedText,
          language: b.language,
          ocrConfidence: b.confidence,
          lineNumber: b.lineNumber,
          blockIndex: i,
        })),
      });
    }
    await prisma.prescriptionPage.update({
      where: { id: page.id },
      data: { currentOcrRunId: ocrRun.id },
    });
    return rx.id;
  }

  beforeAll(async () => {
    app = await createTestApp();
    engine = app.get(DrugMatchingEngine);
    await cleanup();

    const uploader = await prisma.user.create({
      data: {
        email: `uploader.${TAG.toLowerCase()}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'رافع',
        nameEn: 'Fixture Uploader',
        roles: { create: { role: { connect: { key: 'AGENT' } } } },
      },
    });
    uploaderId = uploader.id;

    const tabletForm = await prisma.dosageForm.findUniqueOrThrow({ where: { code: 'TABLET' } });
    tabletFormId = tabletForm.id;
    const mgUnit = await prisma.measurementUnit.findUniqueOrThrow({ where: { code: 'mg' } });
    mgUnitId = mgUnit.id;

    const manufacturer = await prisma.manufacturer.create({
      data: { nameEn: `${TAG} GSK`, normalizedNameEn: normalizeSearchInput(`${TAG} GSK`) },
    });

    // A clean, uncontested drug — used for the HIGH_CONFIDENCE /
    // no-competitor scenario.
    const augmentinName = `${TAG} Augmentin`;
    const augmentinDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}1`,
        nameEn: augmentinName,
        normalizedTradeNameEnglish: normalizeSearchInput(augmentinName),
        searchNameEnglish: normalizeSearchInput(augmentinName),
        combinedSearchText: normalizeSearchInput(augmentinName),
        dosageFormId: tabletFormId,
        manufacturerId: manufacturer.id,
        strengthText: '1000 mg',
        dataQualityStatus: 'VERIFIED',
        active: true,
        strengthComponents: {
          create: {
            numeratorValue: 1000,
            numeratorUnitId: mgUnitId,
            originalStrengthText: '1000 mg',
          },
        },
      },
    });
    augmentinDrugId = augmentinDrug.id;

    // Two near-identical drugs (same normalized name prefix, close
    // strengths) — used for the AMBIGUOUS-margin scenario.
    const twinBaseName = `${TAG} Amoxiclav`;
    for (const [suffix, strength] of [
      ['A', 625],
      ['B', 625],
    ] as const) {
      const name = `${twinBaseName} ${suffix}`;
      await prisma.drug.create({
        data: {
          materialNo: `${TAG}TWIN${suffix}`,
          nameEn: name,
          normalizedTradeNameEnglish: normalizeSearchInput(name),
          searchNameEnglish: normalizeSearchInput(name),
          combinedSearchText: normalizeSearchInput(twinBaseName),
          dosageFormId: tabletFormId,
          strengthText: `${strength} mg`,
          dataQualityStatus: 'VERIFIED',
          active: true,
          strengthComponents: {
            create: {
              numeratorValue: strength,
              numeratorUnitId: mgUnitId,
              originalStrengthText: `${strength} mg`,
            },
          },
        },
      });
    }

    // A discontinued drug — used for the conflict-penalty scenario.
    const discontinuedName = `${TAG} OldDrug`;
    const discontinuedDrug = await prisma.drug.create({
      data: {
        materialNo: `${TAG}DISC`,
        nameEn: discontinuedName,
        normalizedTradeNameEnglish: normalizeSearchInput(discontinuedName),
        searchNameEnglish: normalizeSearchInput(discontinuedName),
        combinedSearchText: normalizeSearchInput(discontinuedName),
        dosageFormId: tabletFormId,
        strengthText: '500 mg',
        dataQualityStatus: 'VERIFIED',
        active: true,
        discontinued: true,
        strengthComponents: {
          create: {
            numeratorValue: 500,
            numeratorUnitId: mgUnitId,
            originalStrengthText: '500 mg',
          },
        },
      },
    });
    discontinuedDrugId = discontinuedDrug.id;
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('MATCH-1 an uncontested exact match resolves HIGH_CONFIDENCE with zero conflicts, never auto-approving', async () => {
    const prescriptionId = await seedPrescription([
      {
        rawText: `${TAG} Augmentin 1000 mg tablet`,
        normalizedText: normalizeSearchInput(`${TAG} Augmentin 1000 mg tablet`),
        language: 'en',
        confidence: 0.95,
        lineNumber: 0,
      },
    ]);

    const run = await engine.run(prescriptionId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe('MATCHING_REVIEW_REQUIRED');
    expect(run!.lineCount).toBe(1);
    expect(run!.matchedLineCount).toBe(1);

    const line = await prisma.prescriptionMedicationLine.findFirstOrThrow({
      where: { prescriptionId },
    });
    expect(line.probableLineType).toBe('MEDICATION');
    expect(line.matchingStatus).toBe('HIGH_CONFIDENCE');
    // Never auto-cleared — a real pharmacist decision is always required
    // regardless of how confident the engine is (design summary §2).
    expect(line.reviewRequired).toBe(true);
    expect(line.selectedDrugId).toBeNull();

    // Every fixture in this file shares the same TAG prefix, so the
    // fuzzy-trigram strategy legitimately surfaces the sibling fixtures
    // too (real, correct behavior) — what matters is that the true
    // match ranks first, with a wide, unambiguous margin over them.
    const candidates = await prisma.prescriptionDrugCandidate.findMany({
      where: { medicationLineId: line.id },
      orderBy: { rank: 'asc' },
    });
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const top = candidates[0]!;
    expect(top.matchedDrugId).toBe(augmentinDrugId);
    expect(top.rank).toBe(1);
    expect(top.selected).toBe(false);
    expect(top.confidenceLevel).toBe('VERY_HIGH');
    expect(top.nameScore).toBe(100);
    expect(top.strengthScore).toBe(100);
    expect(top.dosageFormScore).toBe(100);
    expect((top.conflictsJson as unknown[]).length).toBe(0);
    expect(top.explanationText).toContain('Augmentin');
    if (candidates.length >= 2) {
      expect(top.candidateMargin).toBeGreaterThan(50);
    }
  });

  it('MATCH-2 two near-tied strong candidates resolve AMBIGUOUS, flagging the margin conflict on the top candidate', async () => {
    const prescriptionId = await seedPrescription([
      {
        rawText: `${TAG} Amoxiclav 625 mg`,
        normalizedText: normalizeSearchInput(`${TAG} Amoxiclav 625 mg`),
        language: 'en',
        confidence: 0.95,
        lineNumber: 0,
      },
    ]);

    await engine.run(prescriptionId);
    const line = await prisma.prescriptionMedicationLine.findFirstOrThrow({
      where: { prescriptionId },
    });
    expect(line.matchingStatus).toBe('AMBIGUOUS');

    const candidates = await prisma.prescriptionDrugCandidate.findMany({
      where: { medicationLineId: line.id },
      orderBy: { rank: 'asc' },
    });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const top = candidates[0]!;
    const conflictCodes = (top.conflictsJson as { code: string }[]).map((c) => c.code);
    expect(conflictCodes).toContain('AMBIGUOUS_MARGIN');
  });

  it('MATCH-3 a discontinued candidate is penalized and flagged, never silently preferred', async () => {
    const prescriptionId = await seedPrescription([
      {
        rawText: `${TAG} OldDrug 500 mg`,
        normalizedText: normalizeSearchInput(`${TAG} OldDrug 500 mg`),
        language: 'en',
        confidence: 0.95,
        lineNumber: 0,
      },
    ]);

    await engine.run(prescriptionId);
    const line = await prisma.prescriptionMedicationLine.findFirstOrThrow({
      where: { prescriptionId },
    });
    const candidates = await prisma.prescriptionDrugCandidate.findMany({
      where: { medicationLineId: line.id },
      orderBy: { rank: 'asc' },
    });
    const discontinued = candidates.find((c) => c.matchedDrugId === discontinuedDrugId);
    expect(discontinued).toBeDefined();
    expect(discontinued!.rank).toBe(1); // still the best textual/strength match — the exact match itself
    const conflictCodes = (discontinued!.conflictsJson as { code: string }[]).map((c) => c.code);
    expect(conflictCodes).toContain('DISCONTINUED_DRUG');
    expect(discontinued!.conflictPenalty).toBeGreaterThan(0);
    // Penalized in score, never silently preferred over the fact that
    // it's discontinued — the line still requires pharmacist attention.
    expect(discontinued!.confidenceLevel).not.toBe('VERY_HIGH');
  });

  it('MATCH-4 no DIC match at all resolves UNRESOLVED with zero candidates, never fabricating one', async () => {
    const prescriptionId = await seedPrescription([
      {
        rawText: 'Completely Unknown Medicine Name Xyz 999 mg',
        normalizedText: normalizeSearchInput('Completely Unknown Medicine Name Xyz 999 mg'),
        language: 'en',
        confidence: 0.95,
        lineNumber: 0,
      },
    ]);

    const run = await engine.run(prescriptionId);
    expect(run!.unresolvedLineCount).toBe(1);

    const line = await prisma.prescriptionMedicationLine.findFirstOrThrow({
      where: { prescriptionId },
    });
    expect(line.matchingStatus).toBe('UNRESOLVED');
    expect(line.reviewRequired).toBe(true);
    const candidates = await prisma.prescriptionDrugCandidate.findMany({
      where: { medicationLineId: line.id },
    });
    expect(candidates).toHaveLength(0);
  });

  it('MATCH-5 non-medication lines (patient info, dates) never get a PrescriptionMedicationLine row', async () => {
    const prescriptionId = await seedPrescription([
      {
        rawText: 'Name: Ahmed Ali',
        normalizedText: 'name: ahmed ali',
        language: 'en',
        confidence: 0.95,
        lineNumber: 0,
      },
      {
        rawText: 'Date: 01/01/2026',
        normalizedText: 'date: 01/01/2026',
        language: 'en',
        confidence: 0.95,
        lineNumber: 1,
      },
    ]);

    const run = await engine.run(prescriptionId);
    expect(run!.lineCount).toBe(0);
    const lines = await prisma.prescriptionMedicationLine.findMany({ where: { prescriptionId } });
    expect(lines).toHaveLength(0);
  });

  it('MATCH-6 a deleted prescription is skipped cleanly rather than throwing (stale/delayed job safety)', async () => {
    const prescriptionId = await seedPrescription([]);
    await prisma.prescription.delete({ where: { id: prescriptionId } });
    const run = await engine.run(prescriptionId);
    expect(run).toBeNull();
  });

  it('MATCH-7 never deletes a prior run — reprocessing the same prescription creates a second DrugMatchRun', async () => {
    const prescriptionId = await seedPrescription([
      {
        rawText: `${TAG} Augmentin 1000 mg`,
        normalizedText: normalizeSearchInput(`${TAG} Augmentin 1000 mg`),
        language: 'en',
        confidence: 0.95,
        lineNumber: 0,
      },
    ]);
    const firstRun = await engine.run(prescriptionId);
    const secondRun = await engine.run(prescriptionId);
    expect(secondRun!.id).not.toBe(firstRun!.id);
    const allRuns = await prisma.drugMatchRun.findMany({ where: { prescriptionId } });
    expect(allRuns).toHaveLength(2);
    const allLines = await prisma.prescriptionMedicationLine.findMany({
      where: { prescriptionId },
    });
    expect(allLines).toHaveLength(2); // one per run, neither overwritten
  });
});
