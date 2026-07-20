import { Test } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as argon2 from "argon2";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { OrdersService } from "../src/orders/orders.service";
import { OrdersPerformanceService } from "../src/orders/orders-performance.service";

/**
 * Proves the correctness rules from spec sections 7/10/11/20 that are easy
 * to silently break: global external-order-number uniqueness, and the
 * expected-vs-completed value KPI bookkeeping (a completed Order's value
 * counts in completed sales only while it stays Completed; moving it away
 * removes it from that aggregation because the KPI is computed live from
 * `status`, not from a cached running total).
 */
describe("Orders workflow (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ordersService: OrdersService;
  let performance: OrdersPerformanceService;

  let agentId: string;
  const meta = { ipAddress: "127.0.0.1", userAgent: "jest" };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    prisma = app.get(PrismaService);
    ordersService = app.get(OrdersService);
    performance = app.get(OrdersPerformanceService);

    const agent = await prisma.user.create({
      data: {
        username: `orders-agent-${Date.now()}`,
        passwordHash: await argon2.hash("Agent@12345"),
        fullName: "Orders Test Agent",
        role: "AGENT",
      },
    });
    agentId = agent.id;
  }, 30_000);

  afterAll(async () => {
    await prisma.orderStatusHistory.deleteMany({ where: { order: { responsibleUserId: agentId } } });
    await prisma.orderNote.deleteMany({ where: { order: { responsibleUserId: agentId } } });
    await prisma.order.deleteMany({ where: { responsibleUserId: agentId } });
    await prisma.customer.deleteMany({ where: { orders: { none: {} }, phone: { startsWith: "+20100000" } } });
    await prisma.user.delete({ where: { id: agentId } }).catch(() => undefined);
    await app.close();
  }, 30_000);

  it("rejects a duplicate external order number with the exact spec-worded message", async () => {
    const orderNumber = `${Date.now()}`.slice(-9);

    await ordersService.createManual(
      {
        externalOrderNumber: orderNumber,
        customerName: "Order Dedupe Customer",
        customerPhone: "+201000001111",
        orderType: "CASH",
        source: "INBOUND_CALL",
        responsibleUserId: agentId,
      },
      agentId,
      meta,
    );

    await expect(
      ordersService.createManual(
        {
          externalOrderNumber: orderNumber,
          customerName: "Different Customer",
          customerPhone: "+201000002222",
          orderType: "CASH",
          source: "INBOUND_CALL",
          responsibleUserId: agentId,
        },
        agentId,
        meta,
      ),
    ).rejects.toThrow("This order number already exists in Milaserv 360.");
  });

  it("rejects a non-digit order number when the format is DIGITS_ONLY (the default)", async () => {
    await expect(
      ordersService.createManual(
        {
          externalOrderNumber: "ABC-123",
          customerName: "Alpha Customer",
          customerPhone: "+201000003333",
          orderType: "CASH",
          source: "INBOUND_CALL",
          responsibleUserId: agentId,
        },
        agentId,
        meta,
      ),
    ).rejects.toThrow(/digits only/i);
  });

  it("counts a Completed order's value in KPIs, then excludes it once moved off Completed", async () => {
    const orderNumber = `${Date.now()}`.slice(-9) + "1";
    const order = await ordersService.createManual(
      {
        externalOrderNumber: orderNumber,
        customerName: "KPI Test Customer",
        customerPhone: "+201000004444",
        orderType: "CASH",
        source: "INBOUND_CALL",
        responsibleUserId: agentId,
      },
      agentId,
      meta,
    );

    await ordersService.updateStatus(order.id, { status: "COMPLETED", completedValue: 500 }, agentId, meta);

    const monthKey = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
    const afterCompleted = await performance.agentPerformance(agentId, monthKey);
    expect(afterCompleted.cashCompletedSales).toBeGreaterThanOrEqual(500);

    // Moving a completed order back to Pending must remove its value from
    // completed-sales KPIs (spec section 10/11) — proven by the live
    // aggregation query filtering on status=COMPLETED, not a cached total.
    await ordersService.updateStatus(order.id, { status: "PENDING" }, agentId, meta);
    const afterReverted = await performance.agentPerformance(agentId, monthKey);
    expect(afterReverted.cashCompletedSales).toBe(afterCompleted.cashCompletedSales - 500);
  });

  it("requires a Completed Order Value before allowing the Completed transition", async () => {
    const orderNumber = `${Date.now()}`.slice(-9) + "2";
    const order = await ordersService.createManual(
      {
        externalOrderNumber: orderNumber,
        customerName: "Validation Customer",
        customerPhone: "+201000005555",
        orderType: "CASH",
        source: "INBOUND_CALL",
        responsibleUserId: agentId,
      },
      agentId,
      meta,
    );

    await expect(ordersService.updateStatus(order.id, { status: "COMPLETED" }, agentId, meta)).rejects.toThrow(
      /Completed Order Value is required/,
    );
  });

  it("requires a Cancellation Reason before allowing the Closed transition", async () => {
    const orderNumber = `${Date.now()}`.slice(-9) + "3";
    const order = await ordersService.createManual(
      {
        externalOrderNumber: orderNumber,
        customerName: "Closed Customer",
        customerPhone: "+201000006666",
        orderType: "CASH",
        source: "INBOUND_CALL",
        responsibleUserId: agentId,
      },
      agentId,
      meta,
    );

    await expect(ordersService.updateStatus(order.id, { status: "CLOSED" }, agentId, meta)).rejects.toThrow(
      /Cancellation Reason is required/,
    );
  });

  it("rejects a status update that races against another one instead of silently losing it", async () => {
    const orderNumber = `${Date.now()}`.slice(-9) + "5";
    const order = await ordersService.createManual(
      {
        externalOrderNumber: orderNumber,
        customerName: "Race Test Customer",
        customerPhone: "+201000008888",
        orderType: "CASH",
        source: "INBOUND_CALL",
        responsibleUserId: agentId,
      },
      agentId,
      meta,
    );

    // Two operators racing to move the same PENDING order: one to HOLDED,
    // one to ON_THE_WAY. Both read the same pre-transaction snapshot; the
    // optimistic-concurrency check (updateMany scoped to the status seen at
    // read time) must let exactly one through and reject the other with a
    // clean conflict rather than both silently committing.
    const results = await Promise.allSettled([
      ordersService.updateStatus(order.id, { status: "HOLDED" }, agentId, meta),
      ordersService.updateStatus(order.id, { status: "ON_THE_WAY" }, agentId, meta),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toMatch(/updated by someone else/i);

    // One row from createManual's initial PENDING entry, plus exactly one
    // more from whichever racer won — not two, which would mean both
    // updates committed.
    const history = await prisma.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(2);
  });

  it("records a TimelineEvent for order creation and status changes", async () => {
    const orderNumber = `${Date.now()}`.slice(-9) + "4";
    const order = await ordersService.createManual(
      {
        externalOrderNumber: orderNumber,
        customerName: "Timeline Customer",
        customerPhone: "+201000007777",
        orderType: "CASH",
        source: "INBOUND_CALL",
        responsibleUserId: agentId,
      },
      agentId,
      meta,
    );
    await ordersService.updateStatus(order.id, { status: "HOLDED" }, agentId, meta);

    const events = await prisma.timelineEvent.findMany({ where: { entityType: "Order", entityId: order.id } });
    const eventTypes = events.map((e) => e.eventType);
    expect(eventTypes).toContain("ORDER_CREATED");
    expect(eventTypes).toContain("ORDER_STATUS_CHANGED");
  });
});
