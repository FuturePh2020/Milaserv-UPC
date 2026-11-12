import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from '../../src/server/app.ts';
import type { Router } from '../../src/server/http/router.ts';
import { encryptSecret, totpAad } from '../../src/server/auth/encryption.ts';
import { deriveServerKeys, type ServerKeys } from '../../src/server/auth/keys.ts';
import { PasswordHasher, type ScryptParams } from '../../src/server/auth/passwords.ts';
import { RateLimiter, type RateLimitRules } from '../../src/server/auth/rate-limit.ts';
import { generateTotpSecret, totpCode } from '../../src/server/auth/totp.ts';
import { loadConfig, type AppConfig } from '../../src/server/config.ts';
import type { PasswordHashing } from '../../src/server/context.ts';
import { openDatabase } from '../../src/server/database/connection.ts';
import { applyMigrations, loadMigrations } from '../../src/server/database/migrations.ts';
import { createStaticFiles } from '../../src/server/http/static-files.ts';
import { createLogger } from '../../src/server/logger.ts';
import { MIGRATIONS_DIR } from './database.ts';

/**
 * In-process test server: the REAL createApp served over a real HTTP socket,
 * with a disposable migrated database opened through the runtime authorizer,
 * an injectable clock and a log sink. All credentials are synthetic.
 */

export const TEST_HOST = 'alkhayr.test';
export const CHEAP_PARAMS: ScryptParams = { ln: 10, r: 8, p: 1 };

export interface Clock {
  now(): number;
  advance(ms: number): void;
  set(ms: number): void;
}

export function manualClock(start = Date.UTC(2026, 10, 12, 9, 0, 0)): Clock {
  let t = start;
  return { now: () => t, advance: (ms) => void (t += ms), set: (ms) => void (t = ms) };
}

export interface TestAppOptions {
  production?: boolean;
  trustProxy?: string;
  hasher?: PasswordHashing;
  rules?: Partial<RateLimitRules>;
  maxRateRows?: number;
  busyTimeoutMs?: number;
}

export interface TestApp {
  port: number;
  config: AppConfig;
  keys: ServerKeys;
  clock: Clock;
  /** Runtime connection used by the app (authorizer installed). */
  db: DatabaseSync;
  /** Separate fixture/inspection connection (no authorizer) — tests only. */
  fixtureDb: DatabaseSync;
  hasher: PasswordHashing;
  rateLimiter: RateLimiter;
  logs: string[];
  origin: string;
  /** The app's router — tests may mount TEST-ONLY routes to exercise guards. */
  router: Router;
  close(): Promise<void>;
}

export async function startTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), 'alkhayr-app-'));
  const appSecret = randomBytes(32).toString('base64url');
  const origin = options.production ? `https://${TEST_HOST}` : `http://${TEST_HOST}`;
  const config = loadConfig(
    {
      NODE_ENV: options.production ? 'production' : 'test',
      APP_ORIGIN: origin,
      APP_SECRET: appSecret,
      BACKUP_KEY: randomBytes(32).toString('base64url'),
      DATA_DIR: './data',
      TRUST_PROXY: options.trustProxy ?? '127.0.0.1',
    },
    { baseDir: dir },
  );
  const setup = openDatabase(config.databasePath, { mustExist: false });
  applyMigrations(setup, loadMigrations(MIGRATIONS_DIR));
  const db = openDatabase(config.databasePath, { mustExist: true, runtime: true, ...(options.busyTimeoutMs ? { busyTimeoutMs: options.busyTimeoutMs } : {}) });
  const keys = deriveServerKeys(config.appSecret);
  const clock = manualClock();
  const logs: string[] = [];
  const sink = { write: (l: string) => void logs.push(l) };
  const log = createLogger('debug', sink, sink);
  const hasher = options.hasher ?? new PasswordHasher({ params: CHEAP_PARAMS });
  const rateLimiter = new RateLimiter(db, keys.rateLimit, clock.now, { ...(options.rules ? { rules: options.rules } : {}), ...(options.maxRateRows ? { maxRows: options.maxRateRows } : {}) });
  const app = createApp(config, log, {
    staticFiles: createStaticFiles(path.join(dir, 'no-web'), log, { reloadOnChange: false }),
    readiness: () => true,
    services: { db, now: clock.now, hasher, keys, rateLimiter },
  });
  const server: Server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  return {
    port,
    config,
    keys,
    clock,
    db,
    fixtureDb: setup,
    hasher,
    rateLimiter,
    logs,
    origin,
    router: app.router,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      setup.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ------------------------------------------------------------------ HTTP client

export interface Response {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  setCookies: string[];
}

export interface RequestOptions {
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string | undefined>;
  csrf?: string | null;
  /** Omit the default Origin header on unsafe methods. */
  noOrigin?: boolean;
}

/** Minimal browser-like client: cookie jar, Origin + Fetch-Metadata, optional X-Forwarded-For. */
export class Client {
  readonly cookies = new Map<string, string>();
  csrf: string | null = null;
  readonly app: TestApp;
  readonly ip: string | undefined;
  constructor(app: TestApp, ip?: string) {
    this.app = app;
    this.ip = ip;
  }

  request(method: string, p: string, o: RequestOptions = {}): Promise<Response> {
    const unsafe = method !== 'GET' && method !== 'HEAD';
    const payload = o.rawBody ?? (o.body === undefined ? undefined : JSON.stringify(o.body));
    const headers: Record<string, string> = { Host: TEST_HOST, 'Sec-Fetch-Site': 'same-origin' };
    if (unsafe && !o.noOrigin) headers.Origin = this.app.origin;
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const csrf = o.csrf === undefined ? this.csrf : o.csrf;
    if (unsafe && csrf) headers['X-CSRF-Token'] = csrf;
    if (this.ip) headers['X-Forwarded-For'] = this.ip;
    for (const [k, v] of Object.entries(o.headers ?? {})) {
      if (v === undefined) delete headers[k];
      else headers[k] = v;
    }
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: this.app.port, method, path: p, headers, agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (body += d));
        res.on('end', () => {
          const setCookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
          for (const c of setCookies) {
            const [pair] = c.split(';');
            const eq = pair!.indexOf('=');
            const name = pair!.slice(0, eq);
            const value = pair!.slice(eq + 1);
            if (/Max-Age=0/.test(c) || value === '') this.cookies.delete(name);
            else this.cookies.set(name, value);
          }
          let json: unknown = undefined;
          try {
            json = JSON.parse(body);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json, setCookies });
        });
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  /**
   * Sends the JSON body in two halves and runs `midway` in between: the handler has
   * already authenticated the request when the race action happens.
   */
  requestSlow(method: string, p: string, body: unknown, midway: () => unknown | Promise<unknown>): Promise<Response> {
    const payload = Buffer.from(JSON.stringify(body));
    const headers: Record<string, string> = {
      Host: TEST_HOST,
      'Sec-Fetch-Site': 'same-origin',
      Origin: this.app.origin,
      'Content-Type': 'application/json',
      'Content-Length': String(payload.length),
    };
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
    if (this.ip) headers['X-Forwarded-For'] = this.ip;
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: this.app.port, method, path: p, headers, agent: false }, (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (text += d));
        res.on('end', () => {
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text, json, setCookies: ([] as string[]).concat(res.headers['set-cookie'] ?? []) });
        });
      });
      req.on('error', reject);
      req.write(payload.subarray(0, Math.floor(payload.length / 2)));
      setTimeout(async () => {
        try {
          await midway();
        } catch (err) {
          reject(err);
          return;
        }
        req.end(payload.subarray(Math.floor(payload.length / 2)));
      }, 60);
    });
  }

  async preLogin(): Promise<string> {
    const r = await this.request('GET', '/api/v1/auth/csrf');
    if (r.status !== 200) throw new Error(`csrf failed: ${r.status} ${r.body}`);
    this.csrf = r.json.preLoginToken as string;
    return this.csrf;
  }

  async login(username: string, password: string, totp?: string): Promise<Response> {
    await this.preLogin();
    const r = await this.request('POST', '/api/v1/auth/login', { body: { username, password, ...(totp === undefined ? {} : { totp }) } });
    if (r.status === 200) this.csrf = r.json.csrfToken as string;
    return r;
  }

  sessionCookieName(): string {
    return this.app.config.isProduction ? '__Host-alkhayr_session' : 'alkhayr_session';
  }

  sessionToken(): string | undefined {
    return this.cookies.get(this.sessionCookieName());
  }
}

// ------------------------------------------------------------------ fixtures (synthetic accounts)

export const PROFILE = { businessName: 'محل الاختبار', contactName: 'أحمد علي', phone: '01012345678', governorate: 'القاهرة', address: '12 شارع التجربة' };

export async function createTrader(app: TestApp, o: { username?: string; password?: string; status?: 'pending' | 'approved' | 'suspended' } = {}) {
  const username = o.username ?? `trader.${randomBytes(4).toString('hex')}`;
  const password = o.password ?? `Trader-Fixture-${randomBytes(6).toString('hex')}`;
  const id = randomUUID();
  const t = app.clock.now();
  app.fixtureDb
    .prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, created_at, updated_at) VALUES (?, ?, ?, ?, 'trader', ?, ?)")
    .run(id, username, await app.hasher.hash(password), t, t, t);
  const merchantId = randomUUID();
  app.fixtureDb
    .prepare('INSERT INTO merchants (id, user_id, business_name, contact_name, phone, governorate, address, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)')
    .run(merchantId, id, PROFILE.businessName, PROFILE.contactName, PROFILE.phone, PROFILE.governorate, PROFILE.address, o.status ?? 'approved', t, t);
  return { id, merchantId, username, password };
}

export async function createAdmin(app: TestApp, o: { username?: string; password?: string; lastOtpStep?: number | null } = {}) {
  const username = o.username ?? `admin.${randomBytes(4).toString('hex')}`;
  const password = o.password ?? `Admin-Fixture-Passphrase-${randomBytes(6).toString('hex')}`;
  const id = randomUUID();
  const secret = generateTotpSecret();
  const t = app.clock.now();
  app.fixtureDb
    .prepare("INSERT INTO auth_users (id, username, password_hash, password_changed_at, role, totp_ciphertext, last_otp_step, created_at, updated_at) VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?)")
    .run(id, username, await app.hasher.hash(password), t, encryptSecret(app.keys.totp, secret, totpAad(id)), o.lastOtpStep ?? null, t, t);
  const merchantId = randomUUID();
  app.fixtureDb
    .prepare("INSERT INTO merchants (id, user_id, business_name, contact_name, phone, governorate, address, status, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 1, ?, ?)")
    .run(merchantId, id, 'شركة الخير', 'المدير', '01112345678', 'القاهرة', '1 شارع الإدارة', t, t);
  return { id, merchantId, username, password, secret, code: (offsetSteps = 0) => totpCode(secret, app.clock.now() + offsetSteps * 30_000) };
}

export const count = (app: TestApp, sql: string, ...params: Array<string | number | null>) =>
  Number(Object.values(app.fixtureDb.prepare(sql).get(...params) as object)[0]);

/** Hasher wrapper whose verify() can be paused, to create deterministic races. */
export class GatedHasher implements PasswordHashing {
  readonly inner = new PasswordHasher({ params: CHEAP_PARAMS });
  verifyCalls = 0;
  dummyCalls = 0;
  hashCalls = 0;
  #gate: Promise<void> | null = null;
  #release: (() => void) | null = null;
  #arrived: (() => void) | null = null;

  /** Next verify() calls wait until release(); resolves when the first one is waiting. */
  pause(): Promise<void> {
    this.#gate = new Promise((r) => (this.#release = r));
    return new Promise((r) => (this.#arrived = r));
  }
  release(): void {
    this.#release?.();
    this.#gate = null;
  }
  hash(p: string) {
    this.hashCalls++;
    return this.inner.hash(p);
  }
  async verify(p: string, s: string) {
    this.verifyCalls++;
    const result = await this.inner.verify(p, s);
    if (this.#gate) {
      this.#arrived?.();
      await this.#gate;
    }
    return result;
  }
  async verifyDummy(p: string): Promise<false> {
    this.dummyCalls++;
    return this.inner.verifyDummy(p);
  }
}
