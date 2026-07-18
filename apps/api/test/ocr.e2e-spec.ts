import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';
import { IntegrationsService } from '../src/modules/integrations/integrations.service';

const prisma = new PrismaClient();
const PASSWORD = 'Ocr#12345';
const TAG = 'e2e-ocr';

describe('OCR Prescription Processing (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let integrations: IntegrationsService;
  let managerToken: string;
  let agentToken: string;
  let agent: { id: string };
  let engine: Server;
  let engineCalls: number;
  let nextLines: { text: string; confidence?: number }[];

  let rxId: string; // main prescription driven through the whole flow
  let drugExactId: string;

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
    await prisma.integrationOperation.deleteMany({ where: { integrationKey: 'ocr' } });
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9EOCR' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    const teams = await prisma.team.findMany({ where: { nameEn: { contains: TAG } } });
    await prisma.team.deleteMany({ where: { id: { in: teams.map((t) => t.id) } } });
    await prisma.department.deleteMany({ where: { code: 'EOCR' } });
    await setSetting('integrations.ocr.endpoint', '');
    await setSetting('integrations.retry.max_attempts', 5);
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

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    integrations = app.get(IntegrationsService);
    await cleanup();

    const dept = await prisma.department.create({
      data: { code: 'EOCR', nameAr: 'قسم الوصفات', nameEn: `OCR Dept ${TAG}` },
    });
    const team = await prisma.team.create({
      data: { nameAr: 'فريق الوصفات', nameEn: `OCR Team ${TAG}`, departmentId: dept.id },
    });
    await createUser(`manager.${TAG}@milaserv360.test`, 'TEAM_MANAGER', dept.id, team.id);
    agent = await createUser(`agent.${TAG}@milaserv360.test`, 'AGENT', dept.id, team.id);
    managerToken = await login(`manager.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);

    // Drug-master rows the matcher should hit (unique names, no collisions
    // with the real master data that may be loaded).
    const exact = await prisma.drug.create({
      data: {
        materialNo: '9EOCR1',
        nameEn: 'Ocrtestol 500mg Tab',
        nameAr: 'أوكرتستول ٥٠٠',
        brand: 'OcrBrand',
        coded: true,
        availability: { Jeddah: 7 },
      },
    });
    drugExactId = exact.id;
    await prisma.drug.create({
      data: { materialNo: '9EOCR2', nameEn: 'Ocrtestol Forte Caps', brand: 'OcrBrand' },
    });
    await prisma.drugAlternative.create({
      data: { drugId: exact.id, altMaterialNo: '9EOCR2', order: 0 },
    });

    // Stub OCR engine (spec I1 contract).
    engineCalls = 0;
    nextLines = [];
    engine = createServer((req, res) => {
      engineCalls += 1;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ lines: nextLines }));
    });
    await new Promise<void>((resolve) => engine.listen(0, '127.0.0.1', resolve));
    const address = engine.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    await setSetting('integrations.ocr.endpoint', `http://127.0.0.1:${port}/ocr`);
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await new Promise<void>((resolve) => engine.close(() => resolve()));
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('OC-1 creates a numbered prescription; submit requires the file first (I2)', async () => {
    const res = await request(http)
      .post('/api/v1/ocr/prescriptions')
      .set(auth(agentToken))
      .send({ note: `walkin ${TAG}` })
      .expect(201);
    rxId = res.body.id;
    expect(res.body.number).toMatch(/^PRX-\d{4}-\d{6}$/);
    expect(res.body.status).toBe('UPLOADED');

    await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/submit`)
      .set(auth(agentToken))
      .expect(400); // no attachment yet
  });

  it('OC-2 attach → submit enqueues ocr.extract and moves to EXTRACTING (I1)', async () => {
    await request(http)
      .post(`/api/v1/attachments?entityType=prescription&entityId=${rxId}`)
      .set(auth(agentToken))
      .attach('file', Buffer.from('fake-prescription-image'), {
        filename: 'rx.jpg',
        contentType: 'image/jpeg',
      })
      .expect(201);

    const res = await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/submit`)
      .set(auth(agentToken))
      .expect(200);
    expect(res.body.status).toBe('EXTRACTING');

    const op = await prisma.integrationOperation.findFirst({
      where: { integrationKey: 'ocr', operation: 'extract', status: 'PENDING' },
    });
    expect(op).toBeTruthy();
    expect((op!.payload as { prescriptionId: string }).prescriptionId).toBe(rxId);
  });

  it('OC-3 engine results apply: lines matched against the drug master with scores (I3)', async () => {
    nextLines = [
      { text: 'Ocrtestol 500mg Tab', confidence: 0.98 },
      { text: 'Ocrtestol Fort', confidence: 0.71 },
      { text: 'Zzz Unreadable Scribble', confidence: 1.7 }, // clamped to 1
    ];
    const result = await integrations.processDue();
    expect(result.succeeded).toBeGreaterThanOrEqual(1);
    expect(engineCalls).toBeGreaterThanOrEqual(1);

    const detail = await request(http)
      .get(`/api/v1/ocr/prescriptions/${rxId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(detail.body.status).toBe('REVIEW');
    const lines = detail.body.lines as {
      rawText: string;
      engineConfidence: number;
      matchScore: number | null;
      matchedDrug: { materialNo: string } | null;
    }[];
    expect(lines).toHaveLength(3);
    expect(lines[0].matchedDrug?.materialNo).toBe('9EOCR1');
    expect(lines[0].matchScore).toBe(1); // exact
    expect(lines[1].matchedDrug?.materialNo).toBe('9EOCR2');
    expect(lines[1].matchScore).toBe(0.9); // starts-with
    expect(lines[2].matchedDrug).toBeNull(); // unmatched → reviewer decides
    expect(lines[2].engineConfidence).toBe(1); // clamped
  });

  it('OC-4 detail shows availability + alternatives from the DIC master (I5)', async () => {
    const detail = await request(http)
      .get(`/api/v1/ocr/prescriptions/${rxId}`)
      .set(auth(agentToken))
      .expect(200);
    const first = detail.body.lines[0];
    expect(first.matchedDrug.availability).toEqual({ Jeddah: 7 });
    expect(first.alternatives[0].drug.materialNo).toBe('9EOCR2');
  });

  it('OC-5 review endpoints are gated by ocr.review — agents get 403 (I4)', async () => {
    const detail = await request(http)
      .get(`/api/v1/ocr/prescriptions/${rxId}`)
      .set(auth(agentToken))
      .expect(200);
    const lineId = detail.body.lines[0].id;
    await request(http)
      .post(`/api/v1/ocr/lines/${lineId}/decide`)
      .set(auth(agentToken))
      .send({ decision: 'confirm' })
      .expect(403);
    await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/confirm`)
      .set(auth(agentToken))
      .send({})
      .expect(403);
  });

  it('OC-6 reviewer decides lines: confirm, correct, reject (§17 human correction)', async () => {
    const detail = await request(http)
      .get(`/api/v1/ocr/prescriptions/${rxId}`)
      .set(auth(managerToken))
      .expect(200);
    const [l1, l2, l3] = detail.body.lines as { id: string }[];

    const confirmed = await request(http)
      .post(`/api/v1/ocr/lines/${l1.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'confirm' })
      .expect(200);
    expect(confirmed.body.status).toBe('CONFIRMED');

    // The unreadable line cannot be confirmed (no match) — correct it.
    await request(http)
      .post(`/api/v1/ocr/lines/${l3.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'confirm' })
      .expect(400);
    const corrected = await request(http)
      .post(`/api/v1/ocr/lines/${l3.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'correct', drugId: drugExactId })
      .expect(200);
    expect(corrected.body.status).toBe('CORRECTED');
    expect(corrected.body.matchedDrugId).toBe(drugExactId);
    expect(corrected.body.matchScore).toBeNull(); // human-picked, no score

    const rejected = await request(http)
      .post(`/api/v1/ocr/lines/${l2.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'reject' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');
  });

  it('OC-7 confirm requires every line reviewed, then links order/ticket (I4/I6)', async () => {
    // Add a manual line, leaving it SUGGESTED → confirm must refuse.
    const line = await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/lines`)
      .set(auth(managerToken))
      .send({ rawText: 'Ocrtestol Forte Caps' })
      .expect(201);
    expect(line.body.matchScore).toBe(1); // exact match suggested automatically
    await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/confirm`)
      .set(auth(managerToken))
      .send({})
      .expect(422);
    await request(http)
      .post(`/api/v1/ocr/lines/${line.body.id}/decide`)
      .set(auth(managerToken))
      .send({ decision: 'confirm' })
      .expect(200);

    // Unknown ticket refused; order link accepted.
    await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/confirm`)
      .set(auth(managerToken))
      .send({ ticketNo: 'TKT-0000-000000' })
      .expect(400);
    const res = await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/confirm`)
      .set(auth(managerToken))
      .send({ orderNo: 'EOCR-ORD-1' })
      .expect(200);
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.relatedOrderNo).toBe('EOCR-ORD-1');
    expect(res.body.reviewedById).not.toBeNull();

    // Terminal: no double decision.
    await request(http)
      .post(`/api/v1/ocr/prescriptions/${rxId}/confirm`)
      .set(auth(managerToken))
      .send({})
      .expect(422);

    const note = await prisma.notification.findFirst({
      where: { userId: agent.id, type: 'ocr.decided' },
    });
    expect(note).toBeTruthy();
  });

  it('OC-8 manual entry moves to REVIEW and late engine results are ignored (I1 guard)', async () => {
    const rx = await request(http)
      .post('/api/v1/ocr/prescriptions')
      .set(auth(agentToken))
      .send({})
      .expect(201);
    await request(http)
      .post(`/api/v1/attachments?entityType=prescription&entityId=${rx.body.id}`)
      .set(auth(agentToken))
      .attach('file', Buffer.from('scan2'), { filename: 'rx2.jpg', contentType: 'image/jpeg' })
      .expect(201);
    await request(http)
      .post(`/api/v1/ocr/prescriptions/${rx.body.id}/submit`)
      .set(auth(agentToken))
      .expect(200);

    // Reviewer starts manual entry before the engine answers.
    await request(http)
      .post(`/api/v1/ocr/prescriptions/${rx.body.id}/lines`)
      .set(auth(managerToken))
      .send({ rawText: 'Ocrtestol 500mg Tab' })
      .expect(201);

    nextLines = [{ text: 'ENGINE LINE SHOULD BE IGNORED', confidence: 0.9 }];
    await integrations.processDue();

    const detail = await request(http)
      .get(`/api/v1/ocr/prescriptions/${rx.body.id}`)
      .set(auth(managerToken))
      .expect(200);
    expect(detail.body.status).toBe('REVIEW');
    expect(detail.body.lines).toHaveLength(1); // manual line only
    expect(detail.body.lines[0].rawText).toBe('Ocrtestol 500mg Tab');

    const timeline = await prisma.timelineEvent.findFirst({
      where: { entityType: 'prescription', entityId: rx.body.id, eventType: 'late_result_ignored' },
    });
    expect(timeline).toBeTruthy();
  });

  it('OC-9 rejection is recorded; agents see only their own prescriptions (I8 scope)', async () => {
    // Manager uploads a prescription of their own.
    const managerRx = await request(http)
      .post('/api/v1/ocr/prescriptions')
      .set(auth(managerToken))
      .send({})
      .expect(201);
    const rejected = await request(http)
      .post(`/api/v1/ocr/prescriptions/${managerRx.body.id}/reject`)
      .set(auth(managerToken))
      .send({ note: 'unreadable scan' })
      .expect(200);
    expect(rejected.body.status).toBe('REJECTED');

    // Agent (MY_RECORDS) lists only their own uploads.
    const list = await request(http)
      .get('/api/v1/ocr/prescriptions')
      .set(auth(agentToken))
      .expect(200);
    const uploaderIds = new Set(
      (list.body.items as { uploadedById: string }[]).map((p) => p.uploadedById),
    );
    expect(uploaderIds.size).toBeGreaterThan(0);
    expect([...uploaderIds]).toEqual([agent.id]);

    // Manager (DEPARTMENT) sees both.
    const mgrList = await request(http)
      .get('/api/v1/ocr/prescriptions')
      .set(auth(managerToken))
      .expect(200);
    expect(mgrList.body.total).toBeGreaterThanOrEqual(3);
  });
});
