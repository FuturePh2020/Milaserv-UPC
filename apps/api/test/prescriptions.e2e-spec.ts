import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { LocalDiskPrescriptionStorage } from '../src/modules/prescriptions/storage/prescription-storage';

const prisma = new PrismaClient();
const PASSWORD = 'Presc#12345';
const TAG = 'e2e-presc';

/** Real JPEG magic bytes + a marker tail — validatePrescriptionFile sniffs
 *  actual content, so a plain-text buffer named "*.jpg" is correctly
 *  rejected regardless of the declared filename/content-type. */
const jpegBytes = (marker: string) =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(marker)]);

/**
 * CR-001 Prescription Intelligence Engine — Sprint OCR-01
 * (docs/change-requests/CR-001-prescription-intelligence-engine.md).
 *
 * This suite stubs the Python OCR service directly (never the real
 * services/ocr-service mock) so every scenario is deterministic and does
 * not depend on filename heuristics reaching a signed URL. It exercises
 * the real, asynchronous BullMQ worker — there is no synchronous drain
 * like Phase 10's IntegrationsService.processDue(), so tests poll DB state
 * via waitFor() instead.
 *
 * Out of scope here (no matching engine exists until Sprint OCR-05/06):
 * Arabic/English trade-name matching, scientific-name matching, spelling
 * error tolerance, OCR-character-mistake tolerance, strength/dosage-form
 * extraction accuracy, multiple-similar-medicines disambiguation, and the
 * pharmacist correction workflow. Every candidate this sprint's pipeline
 * creates is deliberately unmatched (matchedDrugId: null) and defaults to
 * NEEDS_PHARMACIST_REVIEW — that is Sprint OCR-01's safety contract, not a
 * gap, and is asserted directly below (PX-4).
 */
describe('Prescriptions — CR-001 OCR-01 (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let localStorage: LocalDiskPrescriptionStorage;
  let managerToken: string;
  let agentToken: string;
  let agent: { id: string };
  let manager: { id: string };
  let engine: Server;
  let engineCalls: { path: string }[];
  let lastPreprocessRequest: { imageUrl: string; config?: Record<string, unknown> } | null;
  /** CR-001 Sprint OCR-02 — a tiny valid 1x1 PNG so decoded "versions" are
   *  real, parseable image bytes, not placeholder text. */
  const ONE_PX_PNG_BASE64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  interface Script {
    quality: number;
    issues: string[];
    blocks: {
      rawText: string;
      normalizedText: string;
      boundingBox: Record<string, number>;
      language: string;
      confidence: number;
      lineNumber: number;
    }[];
    detectedLanguage: string;
    candidateIndices: number[];
    failAnalyzeQuality: boolean;
    /** CR-001 Sprint OCR-02 — the rich preprocessing engine's own gate,
     *  independent of Sprint OCR-01's coarse failAnalyzeQuality path. */
    preprocessQualityScore: number;
    preprocessQualityStatus: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'REUPLOAD_REQUIRED';
    /** Empty by default (Sprint OCR-01 tests don't care) — populated by
     *  OCR-02 tests that need real, decodable image version bytes. */
    preprocessVersions: Record<
      string,
      { imageBase64: string; width: number; height: number; format: string }
    >;
    /** CR-001 Sprint OCR-02 Extension — defaults keep every existing
     *  Sprint OCR-01/02 test's pipeline auto-enqueueing exactly as
     *  before (a confident, auto-accepted region). */
    detectRegionManualCropRequired: boolean;
    detectRegionScreenshotDetected: boolean;
    detectRegionSourceType: 'CAMERA' | 'SCANNER' | 'SCREENSHOT' | 'WHATSAPP_SCREENSHOT' | 'UNKNOWN';
    /** Overrides the single default full-frame region with an explicit
     *  candidate list — used by the multi-region selection test. Null
     *  keeps every other test's single-region default unchanged. */
    detectRegionRegions:
      | {
          x: number;
          y: number;
          width: number;
          height: number;
          confidence: number;
          regionType: string;
        }[]
      | null;
  }
  let script: Script;

  const defaultScript = (): Script => ({
    quality: 0.9,
    issues: [],
    blocks: [
      {
        rawText: 'Panadol Extra Tab',
        normalizedText: 'panadol extra tab',
        boundingBox: { x: 0, y: 0, width: 10, height: 5 },
        language: 'en',
        confidence: 0.95,
        lineNumber: 0,
      },
      {
        rawText: 'xzq scrwl unreadable',
        normalizedText: 'xzq scrwl unreadable',
        boundingBox: { x: 0, y: 10, width: 10, height: 5 },
        language: 'en',
        confidence: 0.3,
        lineNumber: 1,
      },
    ],
    detectedLanguage: 'en',
    candidateIndices: [0], // only the high-confidence block is a medicine line
    failAnalyzeQuality: false,
    preprocessQualityScore: 82,
    preprocessQualityStatus: 'GOOD',
    preprocessVersions: {},
    detectRegionManualCropRequired: false,
    detectRegionScreenshotDetected: false,
    detectRegionSourceType: 'CAMERA',
    detectRegionRegions: null,
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const setSetting = (key: string, value: unknown) =>
    prisma.setting.update({
      where: { key_scopeLevel_scopeId: { key, scopeLevel: 'SYSTEM', scopeId: '' } },
      data: { value: value as never },
    });

  async function cleanup() {
    const users = await prisma.user.findMany({ where: { email: { contains: TAG } } });
    await prisma.prescription.deleteMany({
      where: { uploadedById: { in: users.map((u) => u.id) } },
    });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    const teams = await prisma.team.findMany({ where: { nameEn: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
    await prisma.department.deleteMany({ where: { code: 'EPRX' } });
    await setSetting('prescriptions.ocr_service.endpoint', '');
    await setSetting('prescriptions.upload.max_size_mb', 15);
    await setSetting('prescriptions.ocr.quality_minimum', 0.4);
  }

  async function createUser(email: string, roleKey: string, deptId: string, teamId: string) {
    return prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: `User ${email.split('@')[0]}`,
        departmentId: deptId,
        roles: { create: { role: { connect: { key: roleKey } } } },
        teams: { create: { teamId } },
      },
    });
  }

  async function login(email: string): Promise<string> {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return res.body.accessToken;
  }

  /** No synchronous drain exists for this queue (unlike Phase 10's
   *  IntegrationsService.processDue()) — poll the real async BullMQ
   *  worker's DB writes instead. */
  async function waitForPrescriptionStatus(
    id: string,
    statuses: string[],
    timeoutMs = 10000,
  ): Promise<{ status: string }> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const rx = await prisma.prescription.findUniqueOrThrow({ where: { id } });
      if (statuses.includes(rx.status)) return rx;
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for prescription ${id} to reach ${statuses.join('|')}; last status=${rx.status}`,
        );
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  let fileBytesCounter = 0;
  async function createSubmittedPrescription(token: string, fileBytes?: Buffer) {
    fileBytesCounter += 1;
    fileBytes = fileBytes ?? jpegBytes(`fake-scan-${fileBytesCounter}`);
    const rx = await request(http)
      .post('/api/v1/prescriptions')
      .set(auth(token))
      .send({ note: `walkin ${TAG}` })
      .expect(201);
    const upload = await request(http)
      .post(`/api/v1/prescriptions/${rx.body.id}/pages`)
      .set(auth(token))
      .attach('file', fileBytes, { filename: 'rx.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await request(http)
      .post(`/api/v1/prescriptions/${rx.body.id}/submit`)
      .set(auth(token))
      .expect(200);
    return { id: rx.body.id as string, pageId: upload.body.id as string };
  }

  /** Like createSubmittedPrescription, but stops before submit() — used
   *  by the Sprint OCR-02 Extension tests that need to inspect or act on
   *  a page (crop confirmation) while the prescription is still
   *  UPLOADED. */
  async function createPrescriptionWithPage(
    token: string,
    dto: Record<string, string> = {},
    fileBytes?: Buffer,
  ) {
    fileBytesCounter += 1;
    fileBytes = fileBytes ?? jpegBytes(`fake-scan-${fileBytesCounter}`);
    const rx = await request(http)
      .post('/api/v1/prescriptions')
      .set(auth(token))
      .send({ note: `walkin ${TAG}` })
      .expect(201);
    let req = request(http)
      .post(`/api/v1/prescriptions/${rx.body.id}/pages`)
      .set(auth(token))
      .attach('file', fileBytes, { filename: 'rx.jpg', contentType: 'image/jpeg' });
    for (const [key, value] of Object.entries(dto)) req = req.field(key, value);
    const upload = await req.expect(201);
    return { id: rx.body.id as string, pageId: upload.body.id as string, upload: upload.body };
  }

  beforeAll(async () => {
    // Small retry/backoff for the whole suite — only the DLQ test
    // (PX-9) ever fails a job, but this keeps that scenario well under
    // the 30s e2e timeout without a second app instance.
    process.env.PRESCRIPTION_OCR_JOB_ATTEMPTS = '2';
    process.env.PRESCRIPTION_OCR_JOB_BACKOFF_MS = '50';

    app = await createTestApp();
    http = app.getHttpServer();
    localStorage = app.get(LocalDiskPrescriptionStorage);
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: 'EPRX', nameAr: 'قسم الوصفات الذكي', nameEn: `Presc Dept ${TAG}` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق الوصفات الذكي', nameEn: `Presc Team ${TAG}`, departmentId: dept.id },
    });
    manager = await createUser(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER', dept.id, team.id);
    agent = await createUser(`agent.${TAG}@milaserv360.test`, 'AGENT', dept.id, team.id);
    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);

    // Stub Python OCR service — deterministic, script-driven (never the
    // real services/ocr-service mock, which hashes the image URL and
    // cannot be steered from a test).
    engineCalls = [];
    lastPreprocessRequest = null;
    script = defaultScript();
    engine = createServer((req, res) => {
      engineCalls.push({ path: req.url ?? '' });
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        if (req.url === '/v1/analyze-quality') {
          if (script.failAnalyzeQuality) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: 'stubbed failure' }));
            return;
          }
          res.end(JSON.stringify({ qualityScore: script.quality, issues: script.issues }));
        } else if (req.url === '/v1/preprocess') {
          // CR-001 Sprint OCR-02 contract — stubbed here rather than
          // depending on the real Python engine, same rationale as every
          // other route in this file (deterministic, test-controlled).
          lastPreprocessRequest = JSON.parse(body) as {
            imageUrl: string;
            config?: Record<string, unknown>;
          };
          res.end(
            JSON.stringify({
              qualityScore: script.preprocessQualityScore,
              qualityStatus: script.preprocessQualityStatus,
              metrics: {
                resolutionOk: true,
                width: 900,
                height: 1200,
                rotationAngle: 0,
                blurScore: 0.9,
                blurVariance: 500,
                brightnessScore: 0.9,
                brightnessMean: 200,
                contrastScore: 0.8,
                contrastStdDev: 50,
                noiseScore: 0.9,
                noiseLevel: 2,
                cropConfidence: 0.5,
                readableArea: 0.1,
              },
              versions: script.preprocessVersions,
              stagesApplied: ['blurDetection', 'brightnessAnalysis', 'binarization'],
              processorTimingsMs: { blurDetection: 5 },
              processorFailures: [],
              processingDurationMs: 12,
              pageCount: 1,
              pages: null,
            }),
          );
        } else if (req.url === '/v1/detect-and-recognize') {
          res.end(
            JSON.stringify({
              blocks: script.blocks,
              detectedLanguage: script.detectedLanguage,
              providerUsed: 'stub',
              processingTimeMs: 5,
            }),
          );
        } else if (req.url === '/v1/detect-candidates') {
          const { blocks } = JSON.parse(body) as { blocks: Script['blocks'] };
          res.end(
            JSON.stringify({
              candidateLines: script.candidateIndices
                .filter((i) => i < blocks.length)
                .map((i) => ({
                  blockIndex: i,
                  extractedDrugText: blocks[i].normalizedText,
                })),
            }),
          );
        } else if (req.url === '/v1/detect-region') {
          // CR-001 Sprint OCR-02 Extension contract — defaults to an
          // auto-accepted full-frame region (manualCropRequired: false)
          // so every existing Sprint OCR-01/02 test's pipeline keeps
          // auto-enqueueing exactly as before; OCR-02-EXT-specific tests
          // override via script.detectRegion*.
          const regionsSource = script.detectRegionRegions ?? [
            {
              x: 0,
              y: 0,
              width: 900,
              height: 1200,
              confidence: script.detectRegionManualCropRequired ? 0.2 : 0.9,
              regionType: 'document',
            },
          ];
          const regions = regionsSource.map((r, i) => ({ regionIndex: i, ...r }));
          res.end(
            JSON.stringify({
              sourceTypeHint: script.detectRegionSourceType,
              screenshotDetected: script.detectRegionScreenshotDetected,
              screenshotConfidence: script.detectRegionScreenshotDetected ? 0.8 : 0,
              screenshotApplicationHint: script.detectRegionScreenshotDetected ? 'whatsapp' : null,
              originalWidth: 900,
              originalHeight: 1200,
              regions,
              bestRegionIndex: regions.length ? 0 : null,
              manualCropRequired: script.detectRegionManualCropRequired,
            }),
          );
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    await new Promise<void>((resolve) => engine.listen(0, '127.0.0.1', resolve));
    const address = engine.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await setSetting('prescriptions.ocr_service.endpoint', `http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await new Promise<void>((resolve) => engine.close(() => resolve()));
      await prisma.$disconnect();
      await app.close();
      delete process.env.PRESCRIPTION_OCR_JOB_ATTEMPTS;
      delete process.env.PRESCRIPTION_OCR_JOB_BACKOFF_MS;
    }
  });

  it('PX-1 creates a numbered prescription sharing the ocr.number.format sequence', async () => {
    const res = await request(http)
      .post('/api/v1/prescriptions')
      .set(auth(agentToken))
      .send({ note: `walkin ${TAG}`, source: 'branch-counter' })
      .expect(201);
    expect(res.body.number).toMatch(/^PRX-\d{4}-\d{6}$/);
    expect(res.body.status).toBe('UPLOADED');
    expect(res.body.source).toBe('branch-counter');
  });

  it('PX-2 rejects an unauthenticated request and a request missing permission', async () => {
    await request(http).post('/api/v1/prescriptions').send({}).expect(401);
  });

  it('PX-3 upload validates size and file type before accepting a page', async () => {
    const rx = await request(http)
      .post('/api/v1/prescriptions')
      .set(auth(agentToken))
      .send({})
      .expect(201);

    // Wrong content — magic-byte sniffing rejects it regardless of the
    // declared filename/content-type.
    await request(http)
      .post(`/api/v1/prescriptions/${rx.body.id}/pages`)
      .set(auth(agentToken))
      .attach('file', Buffer.from('not-an-image'), {
        filename: 'rx.jpg',
        contentType: 'image/jpeg',
      })
      .expect(400);

    // Over the configured size limit.
    await setSetting('prescriptions.upload.max_size_mb', 1);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      Buffer.alloc(2 * 1024 * 1024),
    ]);
    await request(http)
      .post(`/api/v1/prescriptions/${rx.body.id}/pages`)
      .set(auth(agentToken))
      .attach('file', jpeg, { filename: 'rx.jpg', contentType: 'image/jpeg' })
      .expect(400);
    await setSetting('prescriptions.upload.max_size_mb', 15);

    // Submitting with zero pages is refused.
    await request(http)
      .post(`/api/v1/prescriptions/${rx.body.id}/submit`)
      .set(auth(agentToken))
      .expect(400);
  });

  it('PX-4 happy path: pipeline persists text blocks and NEEDS_PHARMACIST_REVIEW candidates only (safety rule)', async () => {
    script = defaultScript();
    const { id } = await createSubmittedPrescription(agentToken);

    const rx = await waitForPrescriptionStatus(id, ['REVIEW', 'CONFIRMED', 'REJECTED']);
    expect(rx.status).toBe('REVIEW');

    const detail = await request(http)
      .get(`/api/v1/prescriptions/${id}`)
      .set(auth(agentToken))
      .expect(200);
    expect(detail.body.detectedLanguage).toBe('en');

    const page = detail.body.pages[0];
    expect(page.processingStatus).toBe('COMPLETED');
    expect(page.imageQualityScore).toBeCloseTo(0.9);
    expect(page.textBlocks).toHaveLength(2);
    expect(page.textBlocks[0].isMedicineLine).toBe(true); // high-confidence block
    expect(page.textBlocks[1].isMedicineLine).toBe(false); // low-confidence block, filtered

    // Exactly one candidate — from the medicine line only — and it must
    // never be auto-confirmed: no matching engine exists yet (Sprint
    // OCR-05/06), so every candidate defaults to NEEDS_PHARMACIST_REVIEW
    // with no matched drug and no confidence score.
    expect(detail.body.drugCandidates).toHaveLength(1);
    const candidate = detail.body.drugCandidates[0];
    expect(candidate.extractedDrugText).toBe('panadol extra tab');
    expect(candidate.status).toBe('NEEDS_PHARMACIST_REVIEW');
    expect(candidate.matchedDrugId).toBeNull();
    expect(candidate.matchConfidence).toBeNull();
  });

  it('PX-5 duplicate content is flagged, never silently blocked', async () => {
    const bytes = jpegBytes(`duplicate-bytes-${TAG}`);
    const first = await request(http)
      .post('/api/v1/prescriptions')
      .set(auth(agentToken))
      .send({})
      .expect(201);
    const firstUpload = await request(http)
      .post(`/api/v1/prescriptions/${first.body.id}/pages`)
      .set(auth(agentToken))
      .attach('file', bytes, { filename: 'a.jpg', contentType: 'image/jpeg' })
      .expect(201);
    expect(firstUpload.body.possibleDuplicateOfPrescriptionId).toBeNull();

    const second = await request(http)
      .post('/api/v1/prescriptions')
      .set(auth(agentToken))
      .send({})
      .expect(201);
    const secondUpload = await request(http)
      .post(`/api/v1/prescriptions/${second.body.id}/pages`)
      .set(auth(agentToken))
      .attach('file', bytes, { filename: 'b.jpg', contentType: 'image/jpeg' })
      .expect(201); // still succeeds — flagged, not blocked
    expect(secondUpload.body.possibleDuplicateOfPrescriptionId).toBe(first.body.id);
  });

  it('PX-6 poor image quality routes the page to IMAGE_REUPLOAD_REQUIRED and still reaches REVIEW', async () => {
    script = defaultScript();
    script.quality = 0.1;
    script.issues = ['BLUR', 'LOW_RESOLUTION'];
    const { id } = await createSubmittedPrescription(agentToken);

    const rx = await waitForPrescriptionStatus(id, ['REVIEW']);
    expect(rx.status).toBe('REVIEW'); // never silently vanishes

    const detail = await request(http)
      .get(`/api/v1/prescriptions/${id}`)
      .set(auth(agentToken))
      .expect(200);
    expect(detail.body.pages[0].processingStatus).toBe('IMAGE_REUPLOAD_REQUIRED');
    expect(detail.body.pages[0].imageQualityScore).toBeCloseTo(0.1);
    expect(detail.body.pages[0].textBlocks).toHaveLength(0); // pipeline stopped before OCR
    expect(detail.body.drugCandidates).toHaveLength(0);

    script = defaultScript();
  });

  it('PX-7 an empty OCR result (no medicine lines) yields zero candidates without failing', async () => {
    script = defaultScript();
    script.blocks = [];
    script.candidateIndices = [];
    const { id } = await createSubmittedPrescription(agentToken);

    const rx = await waitForPrescriptionStatus(id, ['REVIEW']);
    expect(rx.status).toBe('REVIEW');
    const detail = await request(http)
      .get(`/api/v1/prescriptions/${id}`)
      .set(auth(agentToken))
      .expect(200);
    expect(detail.body.pages[0].processingStatus).toBe('COMPLETED');
    expect(detail.body.pages[0].textBlocks).toHaveLength(0);
    expect(detail.body.drugCandidates).toHaveLength(0);

    script = defaultScript();
  });

  it('PX-8 scope-aware listing: agent sees only their own uploads, manager sees the department', async () => {
    await createSubmittedPrescription(managerToken);

    const agentList = await request(http)
      .get('/api/v1/prescriptions')
      .set(auth(agentToken))
      .expect(200);
    const agentUploaderIds = new Set(
      (agentList.body.items as { uploadedById: string }[]).map((p) => p.uploadedById),
    );
    expect(agentUploaderIds.size).toBeGreaterThan(0);
    expect([...agentUploaderIds]).toEqual([agent.id]);

    const managerList = await request(http)
      .get('/api/v1/prescriptions')
      .set(auth(managerToken))
      .expect(200);
    const managerUploaderIds = new Set(
      (managerList.body.items as { uploadedById: string }[]).map((p) => p.uploadedById),
    );
    expect(managerUploaderIds).toEqual(new Set([agent.id, manager.id]));
  });

  it('PX-9 exhausted retries mark the page FAILED and the prescription still reaches REVIEW (dead-letter, design spec §10)', async () => {
    script = defaultScript();
    script.failAnalyzeQuality = true;
    const { id } = await createSubmittedPrescription(agentToken);

    const rx = await waitForPrescriptionStatus(id, ['REVIEW'], 15000);
    expect(rx.status).toBe('REVIEW');

    const detail = await request(http)
      .get(`/api/v1/prescriptions/${id}`)
      .set(auth(agentToken))
      .expect(200);
    expect(detail.body.pages[0].processingStatus).toBe('FAILED');
    expect(detail.body.pages[0].processingError).toContain('HTTP 500');

    const timeline = await prisma.timelineEvent.findFirst({
      where: {
        entityType: 'prescription_page',
        entityId: detail.body.pages[0].id,
        eventType: 'processing_failed',
      },
    });
    expect(timeline).toBeTruthy();

    script = defaultScript();
  });

  it('PX-10 the local-disk signed URL is byte-correct and rejects tampering/expiry (design spec §9)', async () => {
    script = defaultScript();
    const original = jpegBytes('signed-url-bytes');
    const { pageId } = await createSubmittedPrescription(agentToken, original);

    const page = await prisma.prescriptionPage.findUniqueOrThrow({ where: { id: pageId } });
    const goodUrl = await localStorage.getSignedUrl(page.originalStorageKey, 300);
    const goodPath = goodUrl.replace(/^https?:\/\/[^/]+/, '');

    const ok = await request(http).get(goodPath).expect(200);
    expect(Buffer.from(ok.body as Buffer).equals(original)).toBe(true);

    // Tampered signature.
    const tamperedPath = goodPath.replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));
    await request(http).get(tamperedPath).expect(403);

    // Expired token.
    const expiredUrl = await localStorage.getSignedUrl(page.originalStorageKey, -10);
    const expiredPath = expiredUrl.replace(/^https?:\/\/[^/]+/, '');
    await request(http).get(expiredPath).expect(403);
  });

  // ── CR-001 Sprint OCR-02 — Image Processing & Quality Engine ──────────

  it('PX-11 preprocessing engine persists scores/versions and the three new endpoints expose them', async () => {
    script = defaultScript();
    script.preprocessQualityScore = 91.5;
    script.preprocessQualityStatus = 'EXCELLENT';
    script.preprocessVersions = {
      ENHANCED: { imageBase64: ONE_PX_PNG_BASE64, width: 1, height: 1, format: 'PNG' },
      OCR_READY: { imageBase64: ONE_PX_PNG_BASE64, width: 1, height: 1, format: 'PNG' },
    };
    const { id, pageId } = await createSubmittedPrescription(agentToken);
    await waitForPrescriptionStatus(id, ['REVIEW']);

    const page = await prisma.prescriptionPage.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.finalQualityScore).toBe(91.5);
    expect(page.qualityStatus).toBe('EXCELLENT');
    expect(page.blurScore).toBeCloseTo(0.9);
    expect(page.preprocessingVersion).toBe('1.0.0');
    expect(page.preprocessingDuration).toBe(12);
    expect(page.preprocessingStartedAt).not.toBeNull();
    expect(page.preprocessingCompletedAt).not.toBeNull();
    expect(page.enhancedStorageKey).not.toBeNull();

    const images = await request(http)
      .get(`/api/v1/prescriptions/${id}/images`)
      .set(auth(agentToken))
      .expect(200);
    const versionTypes = (
      images.body.pages[0].versions as { versionType: string; url: string }[]
    ).map((v) => v.versionType);
    expect(versionTypes).toEqual(expect.arrayContaining(['ORIGINAL', 'ENHANCED', 'OCR_READY']));
    // Never overwritten — the original bytes are still fetchable and unrelated to the mock PNG.
    const originalEntry = images.body.pages[0].versions.find(
      (v: { versionType: string }) => v.versionType === 'ORIGINAL',
    );
    const originalPath = (originalEntry.url as string).replace(/^https?:\/\/[^/]+/, '');
    const originalBytes = await request(http).get(originalPath).expect(200);
    expect(Buffer.isBuffer(originalBytes.body)).toBe(true);

    const quality = await request(http)
      .get(`/api/v1/prescriptions/${id}/quality`)
      .set(auth(agentToken))
      .expect(200);
    expect(quality.body.pages[0].finalQualityScore).toBe(91.5);
    expect(quality.body.pages[0].qualityStatus).toBe('EXCELLENT');

    const preprocessing = await request(http)
      .get(`/api/v1/prescriptions/${id}/preprocessing`)
      .set(auth(agentToken))
      .expect(200);
    expect(preprocessing.body.pages[0].preprocessingVersion).toBe('1.0.0');
    expect(preprocessing.body.pages[0].preprocessingDuration).toBe(12);
    expect(preprocessing.body.pages[0].processorFailures).toEqual([]);

    script = defaultScript();
  });

  it('PX-12 the preprocessing engine’s own quality gate (distinct from the coarse OCR-01 gate) also routes to IMAGE_REUPLOAD_REQUIRED', async () => {
    script = defaultScript();
    script.preprocessQualityScore = 22;
    script.preprocessQualityStatus = 'REUPLOAD_REQUIRED';
    const { id, pageId } = await createSubmittedPrescription(agentToken);

    const rx = await waitForPrescriptionStatus(id, ['REVIEW']);
    expect(rx.status).toBe('REVIEW'); // never silently vanishes

    const page = await prisma.prescriptionPage.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.processingStatus).toBe('IMAGE_REUPLOAD_REQUIRED');
    expect(page.finalQualityScore).toBe(22);
    expect(page.qualityStatus).toBe('REUPLOAD_REQUIRED');
    // The pipeline never reached text extraction for a rejected image.
    const blocks = await prisma.oCRTextBlock.findMany({ where: { prescriptionPageId: pageId } });
    expect(blocks).toHaveLength(0);

    script = defaultScript();
  });

  it('PX-13 every configurable threshold is resolved from Settings and sent to the preprocessing engine (ADR-008)', async () => {
    script = defaultScript();
    // Reset — otherwise a leftover capture from an earlier test would
    // satisfy the poll loop below immediately, before this test's own job
    // ever runs.
    lastPreprocessRequest = null;
    await setSetting('prescriptions.preprocessing.min_quality_score', 77);
    await setSetting('prescriptions.preprocessing.max_rotation_degrees', 12);
    await setSetting('prescriptions.preprocessing.enabled_processors', {
      validation: true,
      qualityScoring: true,
      blurDetection: false,
      brightnessAnalysis: true,
      contrastAnalysis: true,
      noiseEstimation: true,
      orientationDetection: true,
      autoRotation: true,
      perspectiveCorrection: true,
      edgeDetection: true,
      autoCrop: true,
      backgroundCleanup: true,
      shadowRemoval: true,
      contrastEnhancement: true,
      sharpening: true,
      grayscale: true,
      binarization: true,
    });

    await createSubmittedPrescription(agentToken);
    const deadline = Date.now() + 5000;
    while (!lastPreprocessRequest && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(lastPreprocessRequest).not.toBeNull();
    expect(lastPreprocessRequest?.config?.minQualityScore).toBe(77);
    expect(lastPreprocessRequest?.config?.maxRotationDegrees).toBe(12);
    expect((lastPreprocessRequest?.config?.enabled as Record<string, boolean>).blurDetection).toBe(
      false,
    );

    await setSetting('prescriptions.preprocessing.min_quality_score', 50);
    await setSetting('prescriptions.preprocessing.max_rotation_degrees', 45);
  });

  it('PX-14 image/quality/preprocessing endpoints are gated by ocr.view like every other prescriptions route', async () => {
    const { id } = await createSubmittedPrescription(agentToken);
    await waitForPrescriptionStatus(id, ['REVIEW']);
    await request(http).get(`/api/v1/prescriptions/${id}/images`).expect(401);
    await request(http).get(`/api/v1/prescriptions/${id}/quality`).expect(401);
    await request(http).get(`/api/v1/prescriptions/${id}/preprocessing`).expect(401);
  });

  // ── CR-001 Sprint OCR-02 Extension — Universal Image Intake & Drag-
  // and-Drop Upload ──────────────────────────────────────────────────

  it('PX-15 upload records sourceType/screenshot detection and the clipboardPasted flag', async () => {
    script = defaultScript();
    script.detectRegionSourceType = 'WHATSAPP_SCREENSHOT';
    script.detectRegionScreenshotDetected = true;
    const { id, pageId, upload } = await createPrescriptionWithPage(agentToken, {
      clipboardPasted: 'true',
    });
    expect(upload.sourceType).toBe('WHATSAPP_SCREENSHOT');
    expect(upload.screenshotDetected).toBe(true);
    expect(upload.screenshotApplicationHint).toBe('whatsapp');
    expect(upload.manualCropRequired).toBe(false);

    const page = await prisma.prescriptionPage.findUniqueOrThrow({ where: { id: pageId } });
    expect(page.sourceType).toBe('WHATSAPP_SCREENSHOT');
    expect(page.screenshotDetected).toBe(true);
    expect(page.clipboardPasted).toBe(true);
    expect(page.manualCropJson).not.toBeNull(); // auto-accepted crop box

    await request(http)
      .post(`/api/v1/prescriptions/${id}/submit`)
      .set(auth(agentToken))
      .expect(200);
    script = defaultScript();
  });

  it('PX-16 a low-confidence region defers to manual crop: submit() skips it, the prescription still reaches REVIEW, and confirming the crop completes it', async () => {
    script = defaultScript();
    script.detectRegionManualCropRequired = true;
    const { id, pageId, upload } = await createPrescriptionWithPage(agentToken);
    expect(upload.manualCropRequired).toBe(true);

    await request(http)
      .post(`/api/v1/prescriptions/${id}/submit`)
      .set(auth(agentToken))
      .expect(200);
    // Degenerate case: the only page needs manual crop, so no worker job
    // ever runs — the prescription must still reach REVIEW promptly
    // rather than being stuck in EXTRACTING forever.
    const afterSubmit = await waitForPrescriptionStatus(id, ['REVIEW']);
    expect(afterSubmit.status).toBe('REVIEW');
    const pageAfterSubmit = await prisma.prescriptionPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(pageAfterSubmit.processingStatus).toBe('QUEUED'); // never enqueued

    await request(http)
      .post(`/api/v1/prescriptions/${id}/pages/${pageId}/crop`)
      .set(auth(agentToken))
      .send({ manualCropBox: { x: 10, y: 10, width: 200, height: 300 } })
      .expect(201);

    const pageAfterCrop = await prisma.prescriptionPage.findUniqueOrThrow({
      where: { id: pageId },
    });
    expect(pageAfterCrop.manualCropRequired).toBe(false);
    expect(pageAfterCrop.manualCropJson).toEqual({ x: 10, y: 10, width: 200, height: 300 });

    // confirmCrop() enqueues immediately since the prescription is past
    // UPLOADED already — poll until the (still-open) worker completes it.
    const deadline = Date.now() + 10000;
    let completed = false;
    while (Date.now() < deadline) {
      const p = await prisma.prescriptionPage.findUniqueOrThrow({ where: { id: pageId } });
      if (p.processingStatus === 'COMPLETED') {
        completed = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(completed).toBe(true);

    script = defaultScript();
  });

  it('PX-17 confirmCrop rejects anything but exactly one of selectedRegionIndices/manualCropBox, and rejects a page that is not awaiting crop', async () => {
    script = defaultScript();
    script.detectRegionManualCropRequired = true;
    const { id, pageId } = await createPrescriptionWithPage(agentToken);

    await request(http)
      .post(`/api/v1/prescriptions/${id}/pages/${pageId}/crop`)
      .set(auth(agentToken))
      .send({})
      .expect(400);
    await request(http)
      .post(`/api/v1/prescriptions/${id}/pages/${pageId}/crop`)
      .set(auth(agentToken))
      .send({ selectedRegionIndices: [0], manualCropBox: { x: 0, y: 0, width: 10, height: 10 } })
      .expect(400);
    await request(http)
      .post(`/api/v1/prescriptions/${id}/pages/${pageId}/crop`)
      .set(auth(agentToken))
      .send({ selectedRegionIndices: [99] }) // unknown region index
      .expect(400);

    await request(http)
      .post(`/api/v1/prescriptions/${id}/pages/${pageId}/crop`)
      .set(auth(agentToken))
      .send({ selectedRegionIndices: [0] })
      .expect(201);

    // Already confirmed — a second attempt is rejected.
    await request(http)
      .post(`/api/v1/prescriptions/${id}/pages/${pageId}/crop`)
      .set(auth(agentToken))
      .send({ selectedRegionIndices: [0] })
      .expect(422);

    script = defaultScript();
  });

  it('PX-18 selecting more than one candidate region spawns a sibling page per extra region and both process independently', async () => {
    script = defaultScript();
    script.detectRegionManualCropRequired = true;
    script.detectRegionRegions = [
      { x: 0, y: 0, width: 400, height: 500, confidence: 0.6, regionType: 'document' },
      { x: 450, y: 0, width: 400, height: 500, confidence: 0.55, regionType: 'document' },
    ];
    const { id, pageId } = await createPrescriptionWithPage(agentToken);

    const confirm = await request(http)
      .post(`/api/v1/prescriptions/${id}/pages/${pageId}/crop`)
      .set(auth(agentToken))
      .send({ selectedRegionIndices: [0, 1] })
      .expect(201);
    expect(confirm.body.spawnedPageIds).toHaveLength(1);
    const spawnedPageId = confirm.body.spawnedPageIds[0] as string;

    await request(http)
      .post(`/api/v1/prescriptions/${id}/submit`)
      .set(auth(agentToken))
      .expect(200);
    const rx = await waitForPrescriptionStatus(id, ['REVIEW']);
    expect(rx.status).toBe('REVIEW');

    const detail = await request(http)
      .get(`/api/v1/prescriptions/${id}`)
      .set(auth(agentToken))
      .expect(200);
    expect(detail.body.pages).toHaveLength(2);
    const ids = detail.body.pages.map((p: { id: string }) => p.id);
    expect(ids).toEqual(expect.arrayContaining([pageId, spawnedPageId]));
    for (const page of detail.body.pages) {
      expect(page.processingStatus).toBe('COMPLETED');
    }

    script = defaultScript();
  });

  it('PX-19 the raw original is fetchable before preprocessing runs and is gated by ocr.view', async () => {
    script = defaultScript();
    script.detectRegionManualCropRequired = true;
    const { id, pageId } = await createPrescriptionWithPage(agentToken);

    await request(http).get(`/api/v1/prescriptions/${id}/pages/${pageId}/original`).expect(401);

    const original = await request(http)
      .get(`/api/v1/prescriptions/${id}/pages/${pageId}/original`)
      .set(auth(agentToken))
      .expect(200);
    expect(original.body.pageId).toBe(pageId);
    expect(typeof original.body.url).toBe('string');

    script = defaultScript();
  });

  it('PX-20 concurrent multi-file uploads to the same prescription never collide on pageNumber (DropZone fires one request per file in parallel)', async () => {
    script = defaultScript();
    const rx = await request(http)
      .post('/api/v1/prescriptions')
      .set(auth(agentToken))
      .send({})
      .expect(201);

    const uploads = await Promise.all(
      [1, 2, 3, 4, 5].map((i) =>
        request(http)
          .post(`/api/v1/prescriptions/${rx.body.id}/pages`)
          .set(auth(agentToken))
          .attach('file', jpegBytes(`concurrent-${i}`), {
            filename: `rx-${i}.jpg`,
            contentType: 'image/jpeg',
          })
          .expect(201),
      ),
    );
    const pageNumbers = uploads.map((u) => u.body.pageNumber as number).sort((a, b) => a - b);
    expect(pageNumbers).toEqual([1, 2, 3, 4, 5]);

    const pages = await prisma.prescriptionPage.findMany({ where: { prescriptionId: rx.body.id } });
    expect(pages).toHaveLength(5);
  });
});
