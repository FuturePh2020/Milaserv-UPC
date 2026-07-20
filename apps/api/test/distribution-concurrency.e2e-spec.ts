import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as argon2 from "argon2";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { DistributionService } from "../src/distribution/distribution.service";

/**
 * Proves the core correctness requirement from spec section 7: the same
 * lead must never be assigned to two agents even when many agents request
 * a lead at exactly the same time. Fires N concurrent generateLead() calls
 * (bypassing HTTP to hit the transaction directly) against a pool smaller
 * than N and asserts: no lead assigned twice, no duplicate LeadAssignment
 * rows, and every successful call got a distinct lead.
 */
describe("DistributionService concurrency (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let distribution: DistributionService;

  let categoryId: string;
  let partnerId: string;
  let taskId: string;
  let batchId: string;
  const agentIds: string[] = [];
  const LEAD_COUNT = 8;
  const AGENT_COUNT = 20;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    distribution = app.get(DistributionService);

    const category = await prisma.leadCategory.create({
      data: { name: `Concurrency Test ${Date.now()}`, code: `CONC-${Date.now()}` },
    });
    categoryId = category.id;

    const partner = await prisma.partner.create({
      data: { name: "Concurrency Partner", code: `CONC-P-${Date.now()}` },
    });
    partnerId = partner.id;

    const task = await prisma.task.create({
      data: { name: "Concurrency Task", code: `CONC-T-${Date.now()}` },
    });
    taskId = task.id;

    const uploader = await prisma.user.create({
      data: {
        username: `conc-admin-${Date.now()}`,
        passwordHash: await argon2.hash("Admin@12345"),
        fullName: "Concurrency Admin",
        role: "ADMIN",
      },
    });

    const batch = await prisma.leadImportBatch.create({
      data: {
        partnerId,
        categoryId,
        taskId,
        fileName: "concurrency.xlsx",
        fileSize: 0,
        status: "COMPLETED",
        duplicateHandling: "SKIP",
        columnMapping: {},
        uploadedById: uploader.id,
      },
    });
    batchId = batch.id;

    for (let i = 0; i < LEAD_COUNT; i++) {
      await prisma.lead.create({
        data: {
          customerName: `Concurrency Lead ${i}`,
          primaryPhone: `+2010000000${i}`,
          primaryPhoneNorm: `+2010000000${i}`,
          categoryId,
          partnerId,
          taskId,
          batchId,
        },
      });
    }

    for (let i = 0; i < AGENT_COUNT; i++) {
      const agent = await prisma.user.create({
        data: {
          username: `conc-agent-${Date.now()}-${i}`,
          passwordHash: await argon2.hash("Agent@12345"),
          fullName: `Concurrency Agent ${i}`,
          role: "AGENT",
          currentAgentStatus: "AVAILABLE",
        },
      });
      agentIds.push(agent.id);
      await prisma.agentSession.create({ data: { userId: agent.id } });
      await prisma.agentTaskPermission.create({ data: { userId: agent.id, taskId } });
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.leadAssignment.deleteMany({ where: { partnerId } });
    await prisma.leadStatusHistory.deleteMany({ where: { lead: { partnerId } } });
    await prisma.auditLog.deleteMany({ where: { entityType: "Lead", entityId: { in: [] } } }).catch(() => undefined);
    await prisma.lead.deleteMany({ where: { partnerId } });
    await prisma.agentSession.deleteMany({ where: { userId: { in: agentIds } } });
    await prisma.agentTaskPermission.deleteMany({ where: { userId: { in: agentIds } } });
    await prisma.user.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.leadImportBatch.delete({ where: { id: batchId } }).catch(() => undefined);
    await prisma.task.delete({ where: { id: taskId } }).catch(() => undefined);
    await prisma.partner.delete({ where: { id: partnerId } }).catch(() => undefined);
    await prisma.leadCategory.delete({ where: { id: categoryId } }).catch(() => undefined);
    await app.close();
  }, 30_000);

  it("never assigns the same lead to two agents under concurrent requests", async () => {
    const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

    const results = await Promise.allSettled(
      agentIds.map((agentId) => distribution.generateLead(agentId, taskId, meta)),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled") as PromiseFulfilledResult<any>[];
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly as many leads exist as should succeed; the rest must be
    // rejected with "no eligible leads" rather than receiving a duplicate.
    expect(fulfilled.length).toBe(LEAD_COUNT);
    expect(rejected.length).toBe(AGENT_COUNT - LEAD_COUNT);

    const assignedLeadIds = fulfilled.map((r) => r.value.id);
    const uniqueLeadIds = new Set(assignedLeadIds);
    expect(uniqueLeadIds.size).toBe(LEAD_COUNT);

    const assignments = await prisma.leadAssignment.findMany({ where: { partnerId } });
    expect(assignments.length).toBe(LEAD_COUNT);

    const assignmentsPerLead = new Map<string, number>();
    for (const a of assignments) {
      assignmentsPerLead.set(a.leadId, (assignmentsPerLead.get(a.leadId) ?? 0) + 1);
    }
    for (const count of assignmentsPerLead.values()) {
      expect(count).toBe(1);
    }

    const remainingUnassigned = await prisma.lead.count({
      where: { partnerId, assignmentStatus: "UNASSIGNED" },
    });
    expect(remainingUnassigned).toBe(0);
  }, 30_000);
});
