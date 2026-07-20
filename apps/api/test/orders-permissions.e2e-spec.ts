import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import * as argon2 from "argon2";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { OrdersService } from "../src/orders/orders.service";

/**
 * Proves the Orders controller's permission guards are actually wired up at
 * the HTTP layer. Earlier tests (orders-workflow.e2e-spec.ts) call
 * OrdersService methods directly, which bypasses the controller entirely —
 * that's exactly how a set of endpoints with no @RequirePermission/@Roles
 * decorator at all (any authenticated user of any role could call them)
 * went unnoticed. These tests go through supertest against the real HTTP
 * route so the guard chain is actually exercised.
 */
describe("Orders permissions (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  const agentUsername = `orders-perm-agent-${Date.now()}`;
  const agentPassword = "AgentPerm@12345";
  const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };
  let agentId: string;
  let orderId: string;

  async function loginAndGetCookies(username: string, password: string) {
    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ username, password });
    expect(res.status).toBe(200);
    const setCookies = res.headers["set-cookie"] as unknown as string[];
    const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
    const csrf = setCookies.find((c) => c.startsWith("csrf_token="))!.split(";")[0].split("=")[1];
    return { cookieHeader, csrf };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    ordersService = app.get(OrdersService);

    const agent = await prisma.user.create({
      data: {
        username: agentUsername,
        passwordHash: await argon2.hash(agentPassword),
        fullName: "Orders Permission Test Agent",
        role: "AGENT",
        status: "ACTIVE",
      },
    });
    agentId = agent.id;

    const orderNumber = `${Date.now()}`.slice(-9);
    const order = await ordersService.createManual(
      {
        externalOrderNumber: orderNumber,
        customerName: "Permission Test Customer",
        customerPhone: "+201000009999",
        orderType: "CASH",
        source: "INBOUND_CALL",
        responsibleUserId: agentId,
      },
      agentId,
      meta,
    );
    orderId = order.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.userPermission.deleteMany({ where: { userId: agentId } });
    await prisma.orderStatusHistory.deleteMany({ where: { order: { responsibleUserId: agentId } } });
    await prisma.orderNote.deleteMany({ where: { order: { responsibleUserId: agentId } } });
    await prisma.order.deleteMany({ where: { responsibleUserId: agentId } });
    await prisma.customer.deleteMany({ where: { orders: { none: {} }, phone: "+201000009999" } });
    await prisma.refreshToken.deleteMany({ where: { userId: agentId } });
    await prisma.auditLog.deleteMany({ where: { userId: agentId } });
    await prisma.user.delete({ where: { id: agentId } }).catch(() => undefined);
    await app.close();
  }, 30_000);

  it("rejects an unauthenticated request to view or mutate an order", async () => {
    const getRes = await request(app.getHttpServer()).get(`/api/orders/${orderId}`);
    expect(getRes.status).toBe(401);

    const putRes = await request(app.getHttpServer()).put(`/api/orders/${orderId}/status`).send({ status: "HOLDED" });
    expect(putRes.status).toBe(401);
  });

  it("lets an agent with the default ORDERS_UPDATE_OWN permission make a non-elevated status transition", async () => {
    const { cookieHeader, csrf } = await loginAndGetCookies(agentUsername, agentPassword);

    const res = await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/status`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrf)
      .send({ status: "HOLDED" });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("HOLDED");
  });

  it("rejects an agent without ORDERS_COMPLETE from marking an order Completed, even though they hold ORDERS_UPDATE_OWN", async () => {
    const { cookieHeader, csrf } = await loginAndGetCookies(agentUsername, agentPassword);

    const res = await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/status`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrf)
      .send({ status: "COMPLETED", completedValue: 999 });

    expect(res.status).toBe(403);

    const stillHolded = await prisma.order.findUnique({ where: { id: orderId } });
    expect(stillHolded?.status).toBe("HOLDED");
  });

  it("allows the Completed transition once the agent is granted ORDERS_COMPLETE", async () => {
    await prisma.userPermission.create({ data: { userId: agentId, permission: "orders.complete" } });
    const { cookieHeader, csrf } = await loginAndGetCookies(agentUsername, agentPassword);

    const res = await request(app.getHttpServer())
      .put(`/api/orders/${orderId}/status`)
      .set("Cookie", cookieHeader)
      .set("x-csrf-token", csrf)
      .send({ status: "COMPLETED", completedValue: 999 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("COMPLETED");
  });
});
