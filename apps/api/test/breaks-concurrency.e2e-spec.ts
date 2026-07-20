import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as argon2 from "argon2";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { BreaksService } from "../src/breaks/breaks.service";

/**
 * Proves spec section 13's hard limit: no more than N agents working the
 * same Task can be on the same Break Type simultaneously (default 3,
 * configurable per break type/task here via BreakTypeTaskLimit).
 */
describe("BreaksService concurrency limit (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let breaksService: BreaksService;

  let taskId: string;
  let breakTypeId: string;
  const agentIds: string[] = [];
  const sessionIds: string[] = [];
  const LIMIT = 3;
  const AGENT_COUNT = 6;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    breaksService = app.get(BreaksService);

    const task = await prisma.task.create({ data: { name: "Break Limit Task", code: `BRK-T-${Date.now()}` } });
    taskId = task.id;

    const breakType = await prisma.breakType.create({
      data: { name: "Break Limit Type", code: `BRK-BT-${Date.now()}`, maxDurationMinutes: 30, maxConcurrentAgents: LIMIT },
    });
    breakTypeId = breakType.id;

    for (let i = 0; i < AGENT_COUNT; i++) {
      const agent = await prisma.user.create({
        data: {
          username: `brk-agent-${Date.now()}-${i}`,
          passwordHash: await argon2.hash("Agent@12345"),
          fullName: `Break Agent ${i}`,
          role: "AGENT",
        },
      });
      agentIds.push(agent.id);
      const session = await prisma.agentSession.create({ data: { userId: agent.id } });
      sessionIds.push(session.id);
      await prisma.taskAssignment.create({ data: { taskId, agentId: agent.id, assignedById: agent.id } });
    }
  }, 60_000);

  afterAll(async () => {
    await prisma.breakRecord.deleteMany({ where: { userId: { in: agentIds } } });
    await prisma.taskAssignment.deleteMany({ where: { agentId: { in: agentIds } } });
    await prisma.agentSession.deleteMany({ where: { userId: { in: agentIds } } });
    await prisma.user.deleteMany({ where: { id: { in: agentIds } } });
    await prisma.breakType.delete({ where: { id: breakTypeId } }).catch(() => undefined);
    await prisma.task.delete({ where: { id: taskId } }).catch(() => undefined);
    await app.close();
  }, 30_000);

  it("blocks the (N+1)th agent on the same task/break-type without an override", async () => {
    const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };
    let allowed = 0;
    let blocked = 0;

    for (const agentId of agentIds) {
      try {
        await breaksService.start({ userId: agentId, breakTypeId, source: "AGENT" });
        allowed++;
      } catch {
        blocked++;
      }
    }

    expect(allowed).toBe(LIMIT);
    expect(blocked).toBe(AGENT_COUNT - LIMIT);

    const activeCount = await prisma.breakRecord.count({ where: { breakTypeId, status: "ACTIVE" } });
    expect(activeCount).toBe(LIMIT);
  });

  it("holds the limit under genuinely concurrent requests, not just sequential ones", async () => {
    // The previous test calls start() one at a time (await inside a loop),
    // which never exercises the check-then-act race between the
    // concurrent-count read and the BreakRecord insert. Promise.allSettled
    // fires all requests at once so any race would show up as more than
    // LIMIT active records.
    const concurrentBreakType = await prisma.breakType.create({
      data: { name: "Concurrent Break Limit Type", code: `BRK-BT-C-${Date.now()}`, maxDurationMinutes: 30, maxConcurrentAgents: LIMIT },
    });

    const results = await Promise.allSettled(
      agentIds.map((agentId) => breaksService.start({ userId: agentId, breakTypeId: concurrentBreakType.id, source: "AGENT" })),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    expect(fulfilled).toBe(LIMIT);

    const activeCount = await prisma.breakRecord.count({ where: { breakTypeId: concurrentBreakType.id, status: "ACTIVE" } });
    expect(activeCount).toBe(LIMIT);

    await prisma.breakRecord.deleteMany({ where: { breakTypeId: concurrentBreakType.id } });
    await prisma.breakType.delete({ where: { id: concurrentBreakType.id } });
  }, 20_000);

  it("allows an admin override past the limit and records it as overridden", async () => {
    const blockedAgentId = agentIds[LIMIT]; // one of the ones rejected above

    const record = await breaksService.start({
      userId: blockedAgentId,
      breakTypeId,
      source: "ADMIN",
      overrideReason: "Coverage shortage - admin approved",
      overriddenByUserId: agentIds[0],
    });

    expect(record.wasOverridden).toBe(true);
    expect(record.overrideReason).toMatch(/admin approved/i);

    const activeCount = await prisma.breakRecord.count({ where: { breakTypeId, status: "ACTIVE" } });
    expect(activeCount).toBe(LIMIT + 1);
  });
});
