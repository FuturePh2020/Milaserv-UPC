import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import * as argon2 from "argon2";
import request from "supertest";
import { io, Socket } from "socket.io-client";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";
import { RetentionService } from "../src/retention/retention.service";
import { ConfigurableSocketIoAdapter } from "../src/realtime/socket-io.adapter";

/**
 * Proves the realtime channel from spec section 19 actually delivers: a
 * subscribed socket receives a "refresh" push the moment a mutation records
 * a TimelineEvent for that channel's entity type — the mechanism
 * useAutoRefresh/TimelineFeed rely on to update pages without waiting for
 * the next poll tick.
 */
describe("Realtime gateway (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let retention: RetentionService;
  let baseUrl: string;
  let accessTokenCookie: string;
  let actorId: string;
  const username = `realtime-test-${Date.now()}`;
  const password = "Passw0rd!23";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useWebSocketAdapter(new ConfigurableSocketIoAdapter(app, "*"));
    await app.init();
    await app.listen(0);
    const address = app.getHttpServer().address();
    baseUrl = `http://127.0.0.1:${address.port}`;

    prisma = app.get(PrismaService);
    retention = app.get(RetentionService);

    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await argon2.hash(password),
        fullName: "Realtime Test User",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    actorId = user.id;

    const loginRes = await request(app.getHttpServer()).post("/api/auth/login").send({ username, password });
    const cookies = loginRes.headers["set-cookie"] as unknown as string[];
    accessTokenCookie = cookies.find((c) => c.startsWith("access_token="))!.split(";")[0];
  }, 30_000);

  afterAll(async () => {
    await prisma.retentionCustomer.deleteMany({ where: { phone: "+201099998888" } });
    await prisma.refreshToken.deleteMany({ where: { user: { username } } });
    await prisma.auditLog.deleteMany({ where: { user: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await app.close();
  }, 30_000);

  it("rejects a socket connection without a valid access_token cookie", async () => {
    // The server accepts the transport handshake (so "connect" may briefly
    // fire) but immediately disconnects once handleConnection's async JWT
    // verification fails — the guarantee under test is the eventual
    // disconnect, not the absence of a "connect" event.
    const client: Socket = io(baseUrl, {
      path: "/api/socket.io",
      transports: ["websocket"],
      forceNew: true,
      reconnection: false,
    });

    const disconnected = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => resolve(false), 5000);
      client.on("disconnect", () => {
        clearTimeout(timeout);
        resolve(true);
      });
    });

    expect(disconnected).toBe(true);
    client.disconnect();
  }, 10_000);

  it("pushes a refresh event to a subscribed client when a RetentionCustomer timeline event is recorded", async () => {
    const client: Socket = io(baseUrl, {
      path: "/api/socket.io",
      extraHeaders: { cookie: accessTokenCookie },
      transports: ["websocket"],
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("socket did not connect")), 5000);
      client.on("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
      client.on("connect_error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    client.emit("subscribe", ["retention"]);

    const refreshPromise = new Promise<{ channel: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("no refresh event received")), 5000);
      client.on("refresh", (payload: { channel: string }) => {
        if (payload.channel === "retention") {
          clearTimeout(timeout);
          resolve(payload);
        }
      });
    });

    await retention.createManual({ name: "Realtime Test Customer", phone: "+201099998888" }, actorId);

    const payload = await refreshPromise;
    expect(payload.channel).toBe("retention");

    client.disconnect();
  }, 15_000);

  it("does not push to a client that never subscribed to the channel", async () => {
    const client: Socket = io(baseUrl, {
      path: "/api/socket.io",
      extraHeaders: { cookie: accessTokenCookie },
      transports: ["websocket"],
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("socket did not connect")), 5000);
      client.on("connect", () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    let received = false;
    client.on("refresh", () => {
      received = true;
    });

    await retention.createManual({ name: "Realtime Test Customer 2", phone: "+201099998889" }, actorId);
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(received).toBe(false);
    client.disconnect();
    await prisma.retentionCustomer.deleteMany({ where: { phone: "+201099998889" } });
  }, 10_000);
});
