import { Client } from "pg";
import * as argon2 from "argon2";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

/**
 * Seeds a dedicated agent + lead directly in Postgres so the golden-path
 * spec is self-contained and doesn't depend on (or consume) the shared
 * seed data from `prisma/seed.ts`.
 */
export default async function globalSetup() {
  const connectionString =
    process.env.DATABASE_URL || "postgresql://lcrm:lcrm@localhost:5432/lcrm?schema=public";
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const partner = await client.query('SELECT id FROM "Partner" WHERE code = $1 LIMIT 1', ["DEMO-PARTNER"]);
    const category = await client.query('SELECT id FROM "LeadCategory" WHERE code = $1 LIMIT 1', ["INSURANCE"]);
    const batch = await client.query('SELECT id FROM "LeadImportBatch" LIMIT 1');

    if (!partner.rows[0] || !category.rows[0] || !batch.rows[0]) {
      throw new Error("Seed data not found — run `pnpm --filter @lcrm/api seed` before the Playwright suite.");
    }

    const partnerId = partner.rows[0].id;
    const categoryId = category.rows[0].id;
    const batchId = batch.rows[0].id;

    const runId = Date.now();

    // A dedicated Task (rather than the shared seeded one) keeps this run's
    // lead pool isolated from other seed/test leads, so FIFO distribution
    // deterministically hands out the lead this test just created.
    const taskId = randomUUID();
    await client.query(
      `INSERT INTO "Task" (id, name, code, "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, true, now(), now())`,
      [taskId, "Playwright E2E Task", `E2E-TASK-${runId}`],
    );
    const username = `e2e-agent-${runId}`;
    const password = "E2eAgent@12345";
    const passwordHash = await argon2.hash(password);
    const agentId = randomUUID();

    await client.query(
      `INSERT INTO "User" (id, username, "passwordHash", "fullName", role, status, "currentAgentStatus", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'AGENT', 'ACTIVE', 'OFFLINE', now(), now())`,
      [agentId, username, passwordHash, "Playwright E2E Agent"],
    );

    await client.query(
      `INSERT INTO "AgentTaskPermission" (id, "userId", "taskId", "createdAt") VALUES ($1, $2, $3, now())`,
      [randomUUID(), agentId, taskId],
    );

    const leadId = randomUUID();
    const phone = `+2010${String(runId).slice(-7)}`;
    await client.query(
      `INSERT INTO "Lead" (
         id, "customerName", "primaryPhone", "primaryPhoneNorm", "categoryId", "partnerId", "taskId", "batchId",
         priority, "workflowStatus", "assignmentStatus", "isDuplicate", "createdAt", "importedAt", "updatedAt"
       ) VALUES ($1, $2, $3, $3, $4, $5, $6, $7, 0, 'NEW', 'UNASSIGNED', false, now(), now(), now())`,
      [leadId, "Playwright Test Lead", phone, categoryId, partnerId, taskId, batchId],
    );

    const fixture = { username, password, leadId, agentId };
    fs.writeFileSync(path.join(__dirname, ".fixture.json"), JSON.stringify(fixture, null, 2));
  } finally {
    await client.end();
  }
}
