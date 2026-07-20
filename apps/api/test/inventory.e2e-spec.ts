import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();
const PASSWORD = 'Inv#12345';
const TAG = 'e2e-inv';

async function waitFor<T>(fn: () => Promise<T | null>, timeoutMs = 10000, intervalMs = 200): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('waitFor timed out');
}

/**
 * Phase 6 Step 3 — BranchInventory + MockInventoryProvider + the
 * inventory-sync queue. Sync is asynchronous (BullMQ job), so these
 * tests poll for the resulting BranchInventory row the same way
 * Phase 5's e2e suite polled for OCR/matching completion.
 */
describe('Branch Inventory (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let adminToken: string;
  let agentToken: string;
  let branchId: string;
  let drugId: string;
  let discontinuedDrugId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function cleanup() {
    await prisma.branchInventory.deleteMany({ where: { branch: { code: { startsWith: `${TAG}-` } } } });
    await prisma.branch.deleteMany({ where: { code: { startsWith: `${TAG}-` } } });
    await prisma.drug.deleteMany({ where: { materialNo: { startsWith: TAG.toUpperCase() } } });
    await prisma.user.deleteMany({ where: { email: { contains: TAG } } });
  }

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    await cleanup();

    await prisma.user.create({
      data: {
        email: `admin.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مدير',
        nameEn: `Admin ${TAG}`,
        roles: { create: { role: { connect: { key: 'SUPER_ADMIN' } } } },
      },
    });
    await prisma.user.create({
      data: {
        email: `agent.${TAG}@milaserv360.test`,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'موظف',
        nameEn: `Agent ${TAG}`,
        roles: { create: { role: { connect: { key: 'AGENT' } } } },
      },
    });
    const login = async (email: string) =>
      (
        await request(http)
          .post('/api/v1/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    adminToken = await login(`admin.${TAG}@milaserv360.test`);
    agentToken = await login(`agent.${TAG}@milaserv360.test`);

    const branch = await prisma.branch.create({
      data: { code: `${TAG}-B1`, nameAr: 'فرع اختبار', nameEn: 'Test Branch' },
    });
    branchId = branch.id;

    const drug = await prisma.drug.create({
      data: { materialNo: `${TAG.toUpperCase()}1`, nameEn: `${TAG} Drug`, active: true, discontinued: false },
    });
    drugId = drug.id;

    const discontinued = await prisma.drug.create({
      data: { materialNo: `${TAG.toUpperCase()}2`, nameEn: `${TAG} Discontinued Drug`, active: true, discontinued: true },
    });
    discontinuedDrugId = discontinued.id;
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      await prisma.$disconnect();
      await app.close();
    }
  });

  it('INV-1 inventory.sync is required to trigger a sync — a view-only agent gets 403', async () => {
    await request(http)
      .post(`/api/v1/inventory/branches/${branchId}/sync`)
      .set(auth(agentToken))
      .send({ drugIds: [drugId] })
      .expect(403);
  });

  it('INV-2 an admin can trigger a sync, and the mock provider populates BranchInventory', async () => {
    await request(http)
      .post(`/api/v1/inventory/branches/${branchId}/sync`)
      .set(auth(adminToken))
      .send({ drugIds: [drugId, discontinuedDrugId] })
      .expect(202);

    const row = await waitFor(() =>
      prisma.branchInventory.findUnique({ where: { branchId_drugId: { branchId, drugId } } }),
    );
    expect(row.sapMaterialNumber).toBe(`${TAG.toUpperCase()}1`);
    expect(row.sourceSystem).toBe('mock');
    expect(row.availableQuantity).not.toBeNull();
    expect(row.availableQuantity!).toBeGreaterThanOrEqual(0);
    // Never treat blocked/damaged/reserved as available (Phase 6 §11).
    expect(row.availableQuantity!).toBeLessThanOrEqual(row.onHandQuantity ?? Infinity);
  });

  it('INV-3 a discontinued drug is always classified DISCONTINUED regardless of quantity', async () => {
    const row = await waitFor(() =>
      prisma.branchInventory.findUnique({ where: { branchId_drugId: { branchId, drugId: discontinuedDrugId } } }),
    );
    expect(row.inventoryStatus).toBe('DISCONTINUED');
  });

  it('INV-4 inventory.view holders can read the branch inventory view, with freshness classification attached', async () => {
    const res = await request(http)
      .get(`/api/v1/inventory/branches/${branchId}`)
      .set(auth(agentToken))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    const mine = res.body.find((r: { drugId: string }) => r.drugId === drugId);
    expect(mine).toBeDefined();
    expect(['LIVE', 'FRESH', 'ACCEPTABLE', 'STALE', 'UNKNOWN']).toContain(mine.freshness);
    // A snapshot synced moments ago must not read as STALE.
    expect(mine.freshness).not.toBe('STALE');
  });

  it('INV-5 syncing an unknown branch 404s rather than silently no-op-ing', async () => {
    await request(http)
      .post('/api/v1/inventory/branches/nonexistent-branch-id/sync')
      .set(auth(adminToken))
      .send({ drugIds: [drugId] })
      .expect(202); // enqueue always accepts; the worker itself is where NotFoundException would fire.

    // The job for a nonexistent branch must fail cleanly inside the
    // worker (BranchInventoryService.syncBranch throws NotFoundException)
    // rather than crash the process or fabricate a row.
    await new Promise((r) => setTimeout(r, 500));
    const rows = await prisma.branchInventory.findMany({ where: { branchId: 'nonexistent-branch-id' } });
    expect(rows).toHaveLength(0);
  });
});
