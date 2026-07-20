import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import { createTestApp } from './setup';

const prisma = new PrismaClient();

const EMAIL = 'e2e-auth@milaserv360.test';
const PASSWORD = 'CorrectHorse#1';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();

    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.user.create({
      data: {
        email: EMAIL,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'مستخدم اختبار',
        nameEn: 'E2E Test User',
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: EMAIL } });
    await prisma.$disconnect();
    await app.close();
  });

  it('GET /health is public', async () => {
    const res = await request(http).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });

  it('rejects wrong password with 401 and audits the failure', async () => {
    await request(http)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: 'wrong-password' })
      .expect(401);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login_failed', actorEmail: EMAIL },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toBeTruthy();
  });

  it('rejects unknown email with the same 401 (no account enumeration)', async () => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@milaserv360.test', password: 'whatever-123' })
      .expect(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('logs in with correct credentials and returns tokens + user', async () => {
    const res = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);

    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toContain('.');
    expect(res.body.user.email).toBe(EMAIL);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.login_success', actorEmail: EMAIL },
    });
    expect(audit).toBeTruthy();
  });

  it('protects endpoints by default and serves /auth/me with a token', async () => {
    await request(http).get('/api/v1/auth/me').expect(401);

    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);

    const me = await request(http)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe(EMAIL);
    expect(me.body.nameAr).toBe('مستخدم اختبار');
  });

  it('rotates refresh tokens and rejects the replayed old token', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);
    const firstRefresh = login.body.refreshToken;

    const refreshed = await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(200);
    expect(refreshed.body.accessToken).toBeTruthy();

    // Old token was rotated out — replay must fail.
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: firstRefresh })
      .expect(401);
  });

  it('logout revokes the session refresh token', async () => {
    const login = await request(http)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD })
      .expect(200);

    await request(http)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(204);

    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('locks the account after repeated failures', async () => {
    const email = 'e2e-lockout@milaserv360.test';
    await prisma.user.deleteMany({ where: { email } });
    await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'قفل',
        nameEn: 'Lockout',
      },
    });

    const maxAttempts = Number(process.env.LOGIN_MAX_ATTEMPTS ?? 5);
    for (let i = 0; i < maxAttempts; i++) {
      await request(http)
        .post('/api/v1/auth/login')
        .send({ email, password: 'bad-password' })
        .expect(401);
    }

    // Correct password now fails with 403 (locked).
    await request(http).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(403);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.locked' } });
    expect(audit).toBeTruthy();

    await prisma.user.deleteMany({ where: { email } });
  });

  it('changes password, revokes other sessions, and enforces min length', async () => {
    const email = 'e2e-changepw@milaserv360.test';
    await prisma.user.deleteMany({ where: { email } });
    await prisma.user.create({
      data: {
        email,
        passwordHash: await argon2.hash(PASSWORD),
        nameAr: 'تغيير',
        nameEn: 'ChangePw',
        mustChangePassword: true,
      },
    });

    const s1 = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(s1.body.mustChangePassword).toBe(true);
    const s2 = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    // Too-short password rejected (env floor).
    await request(http)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${s1.body.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'short-pw' })
      .expect(400);

    const newPassword = 'NewSecret#456xyz';
    await request(http)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${s1.body.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword })
      .expect(204);

    // Other session's refresh token was revoked.
    await request(http)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s2.body.refreshToken })
      .expect(401);

    // New password works and the flag is cleared.
    const relogin = await request(http)
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);
    expect(relogin.body.mustChangePassword).toBe(false);

    await prisma.user.deleteMany({ where: { email } });
  });
});
