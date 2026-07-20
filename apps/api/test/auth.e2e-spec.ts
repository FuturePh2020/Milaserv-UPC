import { Test } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import cookieParser from "cookie-parser";
import * as argon2 from "argon2";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

describe("Auth (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const username = `auth-test-${Date.now()}`;
  const password = "Passw0rd!23";

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api");
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.user.create({
      data: {
        username,
        passwordHash: await argon2.hash(password),
        fullName: "Auth Test User",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { username } } });
    await prisma.auditLog.deleteMany({ where: { user: { username } } });
    await prisma.user.deleteMany({ where: { username } });
    await app.close();
  });

  it("rejects an unknown user without leaking whether the account exists", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/auth/login")
      .send({ username: "does-not-exist", password: "whatever123" });
    expect(res.status).toBe(401);
  });

  it("logs in with valid credentials and sets httpOnly cookies", async () => {
    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ username, password });

    expect(res.status).toBe(200);
    expect(res.body.user.username).toBe(username);

    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c: string) => c.startsWith("access_token=") && c.includes("HttpOnly"))).toBe(true);
    expect(cookies.some((c: string) => c.startsWith("refresh_token=") && c.includes("HttpOnly"))).toBe(true);
    // csrf_token must NOT be HttpOnly — the frontend needs to read it to echo it back.
    const csrfCookie = cookies.find((c: string) => c.startsWith("csrf_token="));
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).not.toContain("HttpOnly");
  });

  it("rejects a mutating request without a matching CSRF header", async () => {
    const loginRes = await request(app.getHttpServer()).post("/api/auth/login").send({ username, password });
    const cookies = (loginRes.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");

    const res = await request(app.getHttpServer()).post("/api/auth/logout").set("Cookie", cookies);
    expect(res.status).toBe(403);
  });

  it("locks the account after repeated failed attempts", async () => {
    const security = await prisma.securitySettings.upsert({
      where: { id: "default" },
      update: {},
      create: { id: "default" },
    });

    for (let i = 0; i < security.maxFailedLoginAttempts; i++) {
      await request(app.getHttpServer()).post("/api/auth/login").send({ username, password: "wrong-password" });
    }

    const res = await request(app.getHttpServer()).post("/api/auth/login").send({ username, password });
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/locked/i);
  });
});
