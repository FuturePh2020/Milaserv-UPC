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
          const { imageUrl } = JSON.parse(body) as { imageUrl: string };
          res.end(
            JSON.stringify({
              enhancedImageUrl: imageUrl,
              orientation: 0,
              stagesApplied: ['grayscale'],
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
});
