import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding database...");

  await prisma.securitySettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  await prisma.distributionSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  await prisma.inactivitySettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  await prisma.breakThresholdSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default" } });
  await prisma.voipSettings.upsert({ where: { id: "default" }, update: {}, create: { id: "default", providerName: "mock" } });

  const statusMappings = [
    ["ANSWERED", "ANSWERED"],
    ["BUSY", "BUSY"],
    ["NO-ANSWER", "NO_ANSWER"],
    ["NOANSWER", "NO_ANSWER"],
    ["ABANDONED", "ABANDONED"],
    ["FAILED", "FAILED"],
    ["RINGING", "RINGING"],
    ["CONNECTED", "CONNECTED"],
    ["COMPLETED", "COMPLETED"],
  ] as const;
  for (const [providerStatus, internalStatus] of statusMappings) {
    await prisma.voipStatusMapping.upsert({
      where: { providerStatus },
      update: { internalStatus },
      create: { providerStatus, internalStatus },
    });
  }

  const insurance = await prisma.leadCategory.upsert({
    where: { code: "INSURANCE" },
    update: {},
    create: { name: "Insurance Leads", code: "INSURANCE", description: "Insurance product leads" },
  });
  const cash = await prisma.leadCategory.upsert({
    where: { code: "CASH" },
    update: {},
    create: { name: "Cash Leads", code: "CASH", description: "Cash loan / cash product leads" },
  });

  const team = await prisma.team.upsert({ where: { name: "Telesales" }, update: {}, create: { name: "Telesales" } });

  const adminPasswordHash = await argon2.hash("Admin@12345");
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      email: "admin@example.com",
      passwordHash: adminPasswordHash,
      fullName: "System Administrator",
      role: "ADMIN",
      status: "ACTIVE",
    },
  });

  const agentPasswordHash = await argon2.hash("Agent@12345");
  const agent = await prisma.user.upsert({
    where: { username: "agent1" },
    update: {},
    create: {
      username: "agent1",
      email: "agent1@example.com",
      passwordHash: agentPasswordHash,
      fullName: "Sample Agent",
      role: "AGENT",
      status: "ACTIVE",
      teamId: team.id,
      extension: "1001",
    },
  });

  const partner = await prisma.partner.upsert({
    where: { code: "DEMO-PARTNER" },
    update: {},
    create: {
      name: "Demo Partner",
      code: "DEMO-PARTNER",
      partnerType: "Bank",
      insuranceEnabled: true,
      cashEnabled: true,
      isActive: true,
      requiredImportColumns: ["customerName", "primaryPhone"],
      duplicateRuleFields: ["phone"],
      categories: { create: [{ categoryId: insurance.id }, { categoryId: cash.id }] },
    },
  });

  const task = await prisma.task.upsert({
    where: { code: "OUTBOUND_CALLS" },
    update: {},
    create: {
      name: "Outbound Calls",
      code: "OUTBOUND_CALLS",
      description: "General outbound calling task",
      requiredQuantity: 0,
      dailyTarget: 50,
      priority: 10,
      isActive: true,
      maxConcurrentBreaks: 3,
      categories: { create: [{ categoryId: insurance.id }, { categoryId: cash.id }] },
      partners: { create: [{ partnerId: partner.id }] },
    },
  });

  await prisma.agentTaskPermission.upsert({
    where: { userId_taskId: { userId: agent.id, taskId: task.id } },
    update: {},
    create: { userId: agent.id, taskId: task.id },
  });

  const breakTypes = [
    { name: "Short Break", code: "SHORT", maxDurationMinutes: 15, isPaid: true, canResume: true, color: "#3b82f6" },
    { name: "Lunch Break", code: "LUNCH", maxDurationMinutes: 60, isPaid: false, canResume: true, color: "#f59e0b" },
    { name: "Prayer Break", code: "PRAYER", maxDurationMinutes: 15, isPaid: true, canResume: true, color: "#10b981" },
    { name: "Technical Break", code: "TECHNICAL", maxDurationMinutes: 20, isPaid: true, canResume: false, color: "#ef4444" },
  ];
  for (const bt of breakTypes) {
    await prisma.breakType.upsert({ where: { code: bt.code }, update: {}, create: { ...bt, maxConcurrentAgents: 3 } });
  }

  const batch = await prisma.leadImportBatch.upsert({
    where: { id: "seed-batch-0000-0000-0000-000000000000" },
    update: {},
    create: {
      id: "seed-batch-0000-0000-0000-000000000000",
      partnerId: partner.id,
      categoryId: insurance.id,
      taskId: task.id,
      fileName: "seed-sample.xlsx",
      fileSize: 0,
      status: "COMPLETED",
      duplicateHandling: "SKIP",
      columnMapping: { customerName: "Name", primaryPhone: "Phone" },
      totalRows: 5,
      successRows: 5,
      failedRows: 0,
      duplicateRows: 0,
      uploadedById: admin.id,
      completedAt: new Date(),
    },
  });

  const sampleLeads = [
    { name: "Ahmed Hassan", phone: "+201001234567" },
    { name: "Mona Ali", phone: "+201007654321" },
    { name: "Youssef Kamal", phone: "+201009998877" },
    { name: "Sara Ibrahim", phone: "+201002223344" },
    { name: "Omar Adel", phone: "+201005556677" },
  ];
  for (const lead of sampleLeads) {
    const existing = await prisma.lead.findFirst({ where: { primaryPhoneNorm: lead.phone, partnerId: partner.id } });
    if (!existing) {
      await prisma.lead.create({
        data: {
          customerName: lead.name,
          primaryPhone: lead.phone,
          primaryPhoneNorm: lead.phone,
          categoryId: insurance.id,
          partnerId: partner.id,
          taskId: task.id,
          batchId: batch.id,
          priority: 0,
        },
      });
    }
  }

  console.log("Seed complete.");
  console.log("Admin login: admin / Admin@12345");
  console.log("Agent login: agent1 / Agent@12345");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
