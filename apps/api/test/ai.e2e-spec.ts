import type { INestApplication } from '@nestjs/common';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import * as argon2 from 'argon2';
import { createTestApp } from './setup';
import { OcrMatchService } from '../src/modules/ocr/ocr-match.service';

const prisma = new PrismaClient();
const TAG = 'e2e-ai';
const PASSWORD = 'Ai#12345';

describe('AI readiness (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let matcher: OcrMatchService;
  let stub: Server;
  let stubPort: number;
  let bridgeCalls: number;
  let nextMaterial: string | null;
  let drugId: string;
  let ingestToken: string;

  const setSetting = (key: string, value: unknown) =>
    prisma.setting.update({
      where: { key_scopeLevel_scopeId: { key, scopeLevel: 'SYSTEM', scopeId: '' } },
      data: { value: value as never },
    });

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { action: 'ai.invoke' } });
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9EAI' } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
    await setSetting('ai.policy.approved', false);
    await setSetting('integrations.ai.endpoint', '');
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    matcher = app.get(OcrMatchService);
    await cleanup();

    const drug = await prisma.drug.create({
      data: { materialNo: '9EAI1', nameEn: 'Aitestol Retard 75mg', brand: 'AiBrand' },
    });
    drugId = drug.id;

    await prisma.user.create({
      data: {
        email: `ingest.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: 'AI ingest user',
        roles: { create: { role: { connect: { key: 'INTEGRATION_SUPPORT' } } } },
      },
    });
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: `ingest.${TAG}@milaserv360.test`, password: PASSWORD })
      .expect(200);
    ingestToken = login.body.accessToken;

    bridgeCalls = 0;
    nextMaterial = null;
    stub = createServer((req, res) => {
      bridgeCalls += 1;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ result: nextMaterial ? { materialNo: nextMaterial } : {} }));
      });
    });
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const address = stub.address();
    stubPort = typeof address === 'object' && address ? address.port : 0;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await new Promise<void>((resolve) => stub.close(() => resolve()));
      await prisma.$disconnect();
      await app.close();
    }
  });

  // A line the deterministic tiers can never match.
  const GIBBERISH = 'zzq wvx unreadable';

  it('AI-1 gate fully closed: no call, no audit, deterministic behavior intact (K2)', async () => {
    expect(await matcher.match(GIBBERISH)).toBeNull();
    expect(bridgeCalls).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'ai.invoke' } })).toBe(0);

    // Deterministic tiers unaffected by the gate.
    const exact = await matcher.match('Aitestol Retard 75mg');
    expect(exact).toEqual({ drugId, score: 1 });
  });

  it('AI-2 endpoint set but policy NOT approved: still no byte leaves (K2)', async () => {
    await setSetting('integrations.ai.endpoint', `http://127.0.0.1:${stubPort}/ai`);
    expect(await matcher.match(GIBBERISH)).toBeNull();
    expect(bridgeCalls).toBe(0);
  });

  it('AI-3 gate open: unmatched line gets an AI suggestion at score 0.6, audited (K3/K4)', async () => {
    await setSetting('ai.policy.approved', true);
    nextMaterial = '9EAI1';

    const match = await matcher.match(GIBBERISH);
    expect(match).toEqual({ drugId, score: 0.6 });
    expect(bridgeCalls).toBe(1);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'ai.invoke' } });
    expect(audit).toBeTruthy();
    expect((audit!.after as { feature: string }).feature).toBe('ocr.match');
    expect((audit!.after as { ok: boolean }).ok).toBe(true);
  });

  it('AI-4 unknown suggestions and bridge failures fall back to unmatched (K1)', async () => {
    nextMaterial = 'GHOST-999'; // not in the master — never trusted
    expect(await matcher.match(GIBBERISH)).toBeNull();

    await setSetting('integrations.ai.endpoint', 'http://127.0.0.1:1/ai'); // bridge down
    expect(await matcher.match(GIBBERISH)).toBeNull();

    const failed = await prisma.auditLog.findFirst({
      where: { action: 'ai.invoke' },
      orderBy: { createdAt: 'desc' },
    });
    expect((failed!.after as { ok: boolean }).ok).toBe(false);
  });

  it('AI-5 connector card reflects the two-switch gate (§2.1)', async () => {
    await setSetting('integrations.ai.endpoint', `http://127.0.0.1:${stubPort}/ai`);
    await setSetting('ai.policy.approved', false);

    let res = await request(http)
      .get('/api/v1/integrations/connectors')
      .set({ Authorization: `Bearer ${ingestToken}` })
      .expect(200);
    let ai = (res.body.connectors as { key: string; configured: boolean; enabled: boolean }[]).find(
      (c) => c.key === 'ai',
    );
    expect(ai).toEqual(expect.objectContaining({ configured: true, enabled: false }));

    await setSetting('ai.policy.approved', true);
    res = await request(http)
      .get('/api/v1/integrations/connectors')
      .set({ Authorization: `Bearer ${ingestToken}` })
      .expect(200);
    ai = (res.body.connectors as { key: string; configured: boolean; enabled: boolean }[]).find(
      (c) => c.key === 'ai',
    );
    expect(ai).toEqual(expect.objectContaining({ configured: true, enabled: true }));
  });
});
