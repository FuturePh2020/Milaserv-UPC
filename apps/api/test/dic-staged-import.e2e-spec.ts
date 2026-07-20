import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'DicImport#12345';
const TAG = 'e2e-dic-import';

/**
 * CR-002 Phase 4 Step 5 — staged Excel import (design doc §7/§20/§21):
 * upload → map → validate (dry run + duplicate detection) → resolve →
 * approve → execute → (optionally) roll back, plus the CSV error
 * report's formula-injection guard.
 */
describe('DIC Staged Import (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let importerToken: string;
  let adminToken: string;
  let agentToken: string;
  let existingDrugId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.drugImportRow.deleteMany({
      where: { batch: { fileName: { startsWith: 'e2e-import-' } } },
    });
    await prisma.drugImportBatch.deleteMany({ where: { fileName: { startsWith: 'e2e-import-' } } });
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: '9EDICIMPORT' } } });
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
    await mk(`importer.${TAG}@milaserv360.test`, 'INTEGRATION_SUPPORT');
    await mk(`admin.${TAG}@milaserv360.test`, 'SUPER_ADMIN');
    await mk(`agent.${TAG}@milaserv360.test`, 'AGENT');

    const login = async (email: string) =>
      (
        await request(http)
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    importerToken = await login(`importer.${TAG}@milaserv360.test`);
    adminToken = await login(`admin.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);

    const existing = await prisma.drug.create({
      data: { materialNo: '9EDICIMPORT_EXIST', nameEn: 'Existing Import Drug', nameAr: null },
    });
    existingDrugId = existing.id;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('IM-1 dic.view-only users cannot upload a batch', async () => {
    await request(http)
      .post('/api/v1/dic/import/staged/batches')
      .set(auth(agentToken))
      .send({ fileName: 'e2e-import-1.xlsx', rows: [{ MaterialCode: 'X', DrugName: 'X' }] })
      .expect(403);
  });

  let batchId: string;

  it('IM-2 dic.import_staged holders can upload a batch, staged as UPLOADED rows', async () => {
    const res = await request(http)
      .post('/api/v1/dic/import/staged/batches')
      .set(auth(importerToken))
      .send({
        fileName: 'e2e-import-1.xlsx',
        rows: [
          {
            MaterialCode: '9EDICIMPORT_EXIST',
            DrugName: 'Existing Drug Updated',
            ArabicName: 'اسم عربي',
          },
          { MaterialCode: '9EDICIMPORT_NEW1', DrugName: 'New Import Drug One' },
          { MaterialCode: '', DrugName: '=SUM(A1:A9)' },
          { MaterialCode: '9EDICIMPORT_NEW1', DrugName: 'Duplicate Within Batch' },
        ],
      })
      .expect(201);
    expect(res.body.status).toBe('UPLOADED');
    expect(res.body.totalRows).toBe(4);
    batchId = res.body.id;
  });

  it('IM-3 validating before a mapping is set is rejected', async () => {
    await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batchId}/validate`)
      .set(auth(importerToken))
      .expect(400);
  });

  it('IM-4 mapping must cover materialNo and nameEn', async () => {
    await request(http)
      .patch(`/api/v1/dic/import/staged/batches/${batchId}/mapping`)
      .set(auth(importerToken))
      .send({ mapping: { DrugName: 'nameEn' } })
      .expect(400);

    const res = await request(http)
      .patch(`/api/v1/dic/import/staged/batches/${batchId}/mapping`)
      .set(auth(importerToken))
      .send({
        mapping: { MaterialCode: 'materialNo', DrugName: 'nameEn', ArabicName: 'nameAr' },
      })
      .expect(200);
    expect(res.body.status).toBe('MAPPING');
  });

  it('IM-5 validate flags an existing-drug duplicate, a valid new row, and two invalid rows', async () => {
    const res = await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batchId}/validate`)
      .set(auth(importerToken))
      .expect(200);
    expect(res.body.status).toBe('VALIDATED');
    expect(res.body.validRows).toBe(1);
    expect(res.body.invalidRows).toBe(2);
    expect(res.body.duplicateRows).toBe(1);

    const preview = await request(http)
      .get(`/api/v1/dic/import/staged/batches/${batchId}/preview`)
      .set(auth(importerToken))
      .expect(200);
    const dup = preview.body.find((r: { rowNumber: number }) => r.rowNumber === 1);
    expect(dup.status).toBe('DUPLICATE');
    expect(dup.duplicateCandidatesJson[0].drugId).toBe(existingDrugId);
    expect(dup.duplicateCandidatesJson[0].matchedOn).toContain('materialNo');
  });

  it('IM-6 approval is blocked while a duplicate row is unresolved, and succeeds once resolved', async () => {
    const preview = await request(http)
      .get(`/api/v1/dic/import/staged/batches/${batchId}/preview`)
      .set(auth(importerToken))
      .expect(200);
    const dupRow = preview.body.find((r: { status: string }) => r.status === 'DUPLICATE');

    await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batchId}/approve`)
      .set(auth(importerToken))
      .expect(422);

    await request(http)
      .patch(`/api/v1/dic/import/staged/rows/${dupRow.id}/resolve`)
      .set(auth(importerToken))
      .send({ resolution: 'LINK_EXISTING', linkedDrugId: existingDrugId })
      .expect(200);

    const approved = await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batchId}/approve`)
      .set(auth(importerToken))
      .expect(200);
    expect(approved.body.status).toBe('APPROVED');
  });

  it('IM-7 execution creates the new drug and enriches the existing one without overwriting its name', async () => {
    const res = await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batchId}/execute`)
      .set(auth(importerToken))
      .expect(200);
    expect(res.body.status).toBe('COMPLETED');
    expect(res.body.importedRows).toBe(2);
    expect(res.body.failedRows).toBe(0);

    const created = await prisma.drug.findUnique({ where: { materialNo: '9EDICIMPORT_NEW1' } });
    expect(created).toBeTruthy();
    expect(created!.sourceSystem).toBe('staged_import');

    const enriched = await prisma.drug.findUnique({ where: { id: existingDrugId } });
    expect(enriched!.nameEn).toBe('Existing Import Drug'); // never overwritten
    expect(enriched!.nameAr).toBe('اسم عربي'); // filled in because it was null
  });

  it('IM-8 the error report CSV guards formula-triggering cells and lists only invalid/failed rows', async () => {
    const res = await request(http)
      .get(`/api/v1/dic/import/staged/batches/${batchId}/error-report.csv`)
      .set(auth(importerToken))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const body = res.text as string;
    expect(body).toContain('"\'=SUM(A1:A9)"');
    expect(body).not.toMatch(/[^"],=SUM/); // never an unguarded leading '='
    expect(body.split('\r\n')).toHaveLength(3); // header + 2 invalid rows
  });

  it('IM-9 dic.import_staged (without dic.admin) cannot roll back a batch', async () => {
    await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batchId}/rollback`)
      .set(auth(importerToken))
      .expect(403);
  });

  it('IM-10 rollback refuses to auto-revert a batch that enriched an existing drug', async () => {
    await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batchId}/rollback`)
      .set(auth(adminToken))
      .expect(422);
    // Nothing was reverted — the enrichment and the new drug both remain.
    const created = await prisma.drug.findUnique({ where: { materialNo: '9EDICIMPORT_NEW1' } });
    expect(created).toBeTruthy();
  });

  it('IM-11 rollback of a batch with only newly-created drugs deletes them and reopens the rows', async () => {
    const upload = await request(http)
      .post('/api/v1/dic/import/staged/batches')
      .set(auth(importerToken))
      .send({
        fileName: 'e2e-import-2.xlsx',
        rows: [{ MaterialCode: '9EDICIMPORT_NEW2', DrugName: 'New Import Drug Two' }],
      })
      .expect(201);
    const batch2Id = upload.body.id;

    await request(http)
      .patch(`/api/v1/dic/import/staged/batches/${batch2Id}/mapping`)
      .set(auth(importerToken))
      .send({ mapping: { MaterialCode: 'materialNo', DrugName: 'nameEn' } })
      .expect(200);
    await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batch2Id}/validate`)
      .set(auth(importerToken))
      .expect(200);
    await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batch2Id}/approve`)
      .set(auth(importerToken))
      .expect(200);
    await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batch2Id}/execute`)
      .set(auth(importerToken))
      .expect(200);
    expect(
      await prisma.drug.findUnique({ where: { materialNo: '9EDICIMPORT_NEW2' } }),
    ).toBeTruthy();

    const rolledBack = await request(http)
      .post(`/api/v1/dic/import/staged/batches/${batch2Id}/rollback`)
      .set(auth(adminToken))
      .expect(200);
    expect(rolledBack.body.status).toBe('ROLLED_BACK');
    expect(await prisma.drug.findUnique({ where: { materialNo: '9EDICIMPORT_NEW2' } })).toBeNull();
  });
});
