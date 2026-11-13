import { readFileSync, statSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { z } from 'zod';

/**
 * Typed, validated runtime configuration. Read once at startup from the
 * process environment. Validation messages name variables only and never echo
 * values (secrets must not reach logs or terminals).
 */

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly host: string;
  readonly port: number;
  /** Exact origin, e.g. "https://portal.example.com". */
  readonly appOrigin: string;
  /** Expected Host header value derived from appOrigin (lowercase, includes non-default port). */
  readonly expectedHost: string;
  readonly dataDir: string;
  /** SQLite database file inside dataDir (WAL/SHM files live next to it). */
  readonly databasePath: string;
  readonly backupDir: string;
  /** Raw secret bytes; null only outside production (features needing them must refuse). */
  readonly appSecret: Buffer | null;
  readonly backupKey: Buffer | null;
  readonly trustProxy: readonly string[];
  readonly acceptOnlyFromProxy: boolean;
  readonly logLevel: LogLevel;
  readonly http: {
    readonly headersTimeoutMs: number;
    readonly requestTimeoutMs: number;
    readonly keepAliveTimeoutMs: number;
    readonly shutdownGraceMs: number;
    readonly maxHeaderBytes: number;
  };
}

export class ConfigError extends Error {
  readonly issues: readonly string[];
  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

const emptyToUndefined = (v: unknown): unknown => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const intInRange = (min: number, max: number, def: number) =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^\d+$/, 'must be a non-negative integer')
      .transform(Number)
      .pipe(z.number().int().min(min).max(max))
      .optional()
      .transform((v) => v ?? def),
  );

const envSchema = z.object({
  NODE_ENV: z.preprocess(emptyToUndefined, z.enum(['development', 'test', 'production']).default('development')),
  HOST: z.preprocess(emptyToUndefined, z.string().max(255).default('127.0.0.1')),
  PORT: intInRange(0, 65535, 3000),
  APP_ORIGIN: z.preprocess(emptyToUndefined, z.string().max(2048).optional()),
  DATA_DIR: z.preprocess(emptyToUndefined, z.string().max(4096).default('./data')),
  BACKUP_DIR: z.preprocess(emptyToUndefined, z.string().max(4096).default('./backups')),
  APP_SECRET: z.preprocess(emptyToUndefined, z.string().max(512).optional()),
  /** Stage 17: path of a protected file holding APP_SECRET (preferred in containers; exclusive with APP_SECRET). */
  APP_SECRET_FILE: z.preprocess(emptyToUndefined, z.string().max(4096).optional()),
  BACKUP_KEY: z.preprocess(emptyToUndefined, z.string().max(512).optional()),
  TRUST_PROXY: z.preprocess(emptyToUndefined, z.string().max(2048).optional()),
  /** Stage 17: refuse TCP connections from anything but TRUST_PROXY addresses (and loopback for health checks). */
  ACCEPT_ONLY_FROM_PROXY: z.preprocess(emptyToUndefined, z.enum(['0', '1', 'true', 'false']).default('0')),
  LOG_LEVEL: z.preprocess(emptyToUndefined, z.enum(['debug', 'info', 'warn', 'error']).default('info')),
  HTTP_HEADERS_TIMEOUT_MS: intInRange(1000, 120_000, 15_000),
  HTTP_REQUEST_TIMEOUT_MS: intInRange(1000, 600_000, 30_000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: intInRange(1000, 120_000, 5_000),
  SHUTDOWN_GRACE_MS: intInRange(1000, 120_000, 10_000),
});

export const DATABASE_FILENAME = 'alkhayr.db';

const PLACEHOLDER_PATTERN = /change[_-]?me|replace[_-]?me|placeholder|example|your[_-]?secret|^secret$|^password$|^x+$/i;
const MIN_SECRET_BYTES = 32;

/**
 * Reads a secret from a protected file (stage 17; e.g. a Compose secret mounted at /run/secrets/...).
 * Requirements: an existing regular file (a symlink is allowed only if it resolves to a regular file, as
 * container runtimes mount secrets that way), owned by root or by the process user, not writable by
 * group/other and not readable by "other", at most 1 KiB. Trailing newline(s) are removed; nothing else is
 * trimmed. The value and the path content are never included in error messages.
 */
export function readSecretFile(name: string, file: string): { ok: true; value: string } | { ok: false; issue: string } {
  let st;
  try {
    st = statSync(file);
  } catch {
    return { ok: false, issue: `${name}: the secret file does not exist or cannot be read` };
  }
  if (!st.isFile()) return { ok: false, issue: `${name}: not a regular file` };
  if (process.platform !== 'win32') {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 0;
    if (st.uid !== 0 && st.uid !== uid) return { ok: false, issue: `${name}: the secret file must be owned by root or by the user running the service` };
    if ((st.mode & 0o022) !== 0) return { ok: false, issue: `${name}: the secret file must not be writable by group or others (chmod 0400 or 0440)` };
    if ((st.mode & 0o004) !== 0) return { ok: false, issue: `${name}: the secret file must not be readable by others (chmod 0400 or 0440)` };
  }
  if (st.size > 1024) return { ok: false, issue: `${name}: the secret file is too large` };
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return { ok: false, issue: `${name}: the secret file cannot be read by the service user` };
  }
  return { ok: true, value: raw.replace(/\r?\n+$/, '') };
}

/** Decode and check a base64url secret. Returns an issue string or the bytes. */
export function parseSecret(name: string, raw: string): Buffer | string {
  if (PLACEHOLDER_PATTERN.test(raw)) return `${name} is a placeholder value; generate a real random secret`;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) return `${name} must be base64url (A-Z a-z 0-9 - _ only, no padding)`;
  const bytes = Buffer.from(raw, 'base64url');
  if (bytes.length < MIN_SECRET_BYTES) return `${name} must decode to at least ${MIN_SECRET_BYTES} bytes`;
  if (bytes.every((b) => b === bytes[0])) return `${name} has no entropy (repeated byte)`;
  return bytes;
}

function parseOrigin(raw: string, isProduction: boolean, issues: string[]): { origin: string; host: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    issues.push('APP_ORIGIN must be an absolute URL such as https://portal.example.com');
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    issues.push('APP_ORIGIN must use http or https');
    return null;
  }
  if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    issues.push('APP_ORIGIN must be an origin only (no credentials, path, query or fragment)');
    return null;
  }
  if (raw.replace(/\/$/, '') !== url.origin) {
    issues.push('APP_ORIGIN must be written in canonical form (lowercase host, no default port)');
    return null;
  }
  if (isProduction && url.protocol !== 'https:') {
    issues.push('APP_ORIGIN must use https in production');
    return null;
  }
  return { origin: url.origin, host: url.host.toLowerCase() };
}

export interface LoadConfigOptions {
  /** Base directory for relative DATA_DIR/BACKUP_DIR (the application root). */
  baseDir: string;
  /** Absolute directory served as static web assets; data dirs may not live inside it. */
  staticRoot?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv, options: LoadConfigOptions): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and rule text only; zod issue messages here do not include input values.
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'environment'}: ${i.message}`));
  }
  const e = parsed.data;
  const issues: string[] = [];
  const isProduction = e.NODE_ENV === 'production';

  if (isProduction && !e.APP_ORIGIN) issues.push('APP_ORIGIN is required in production');
  const origin = parseOrigin(e.APP_ORIGIN ?? `http://localhost:${e.PORT === 0 ? 3000 : e.PORT}`, isProduction, issues);

  const secrets: Record<'APP_SECRET' | 'BACKUP_KEY', Buffer | null> = { APP_SECRET: null, BACKUP_KEY: null };
  // Stage 17: APP_SECRET may come from a protected file. Exactly one source; never both (no precedence rules).
  let appSecretRaw = e.APP_SECRET;
  if (e.APP_SECRET_FILE !== undefined) {
    if (e.APP_SECRET !== undefined) issues.push('Set exactly one of APP_SECRET or APP_SECRET_FILE, not both');
    else {
      const r = readSecretFile('APP_SECRET_FILE', path.resolve(options.baseDir, e.APP_SECRET_FILE));
      if (r.ok) appSecretRaw = r.value;
      else issues.push(r.issue);
    }
  }
  for (const name of ['APP_SECRET', 'BACKUP_KEY'] as const) {
    const raw = name === 'APP_SECRET' ? appSecretRaw : e[name];
    if (raw === undefined) {
      // Stage 15: the server no longer needs BACKUP_KEY (backups use a separate key file or hidden input).
      if (isProduction && name === 'APP_SECRET') issues.push(`${name} is required in production`);
      continue;
    }
    const result = parseSecret(name, raw);
    if (typeof result === 'string') issues.push(result);
    else secrets[name] = result;
  }
  if (secrets.APP_SECRET && secrets.BACKUP_KEY && secrets.APP_SECRET.equals(secrets.BACKUP_KEY)) {
    issues.push('BACKUP_KEY must be independent of APP_SECRET');
  }

  const trustProxy: string[] = [];
  for (const entry of (e.TRUST_PROXY ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (isIP(entry) === 0) issues.push('TRUST_PROXY must be a comma-separated list of exact IP addresses');
    else trustProxy.push(entry);
  }

  const acceptOnlyFromProxy = e.ACCEPT_ONLY_FROM_PROXY === '1' || e.ACCEPT_ONLY_FROM_PROXY === 'true';
  if (acceptOnlyFromProxy && trustProxy.length === 0) issues.push('ACCEPT_ONLY_FROM_PROXY requires TRUST_PROXY (the proxy address)');

  if (e.HTTP_REQUEST_TIMEOUT_MS < e.HTTP_HEADERS_TIMEOUT_MS) {
    issues.push('HTTP_REQUEST_TIMEOUT_MS must be greater than or equal to HTTP_HEADERS_TIMEOUT_MS');
  }

  const dataDir = path.resolve(options.baseDir, e.DATA_DIR);
  const backupDir = path.resolve(options.baseDir, e.BACKUP_DIR);
  if (options.staticRoot) {
    const root = path.resolve(options.staticRoot);
    for (const [name, dir] of [['DATA_DIR', dataDir], ['BACKUP_DIR', backupDir]] as const) {
      if (dir === root || dir.startsWith(root + path.sep) || root.startsWith(dir + path.sep)) {
        issues.push(`${name} must not overlap the static web directory`);
      }
    }
  }

  if (issues.length > 0 || !origin) throw new ConfigError(issues);

  return Object.freeze({
    nodeEnv: e.NODE_ENV,
    isProduction,
    host: e.HOST,
    port: e.PORT,
    appOrigin: origin.origin,
    expectedHost: origin.host,
    dataDir,
    databasePath: path.join(dataDir, DATABASE_FILENAME),
    backupDir,
    appSecret: secrets.APP_SECRET,
    backupKey: secrets.BACKUP_KEY,
    trustProxy: Object.freeze(trustProxy),
    acceptOnlyFromProxy,
    logLevel: e.LOG_LEVEL,
    http: Object.freeze({
      headersTimeoutMs: e.HTTP_HEADERS_TIMEOUT_MS,
      requestTimeoutMs: e.HTTP_REQUEST_TIMEOUT_MS,
      keepAliveTimeoutMs: e.HTTP_KEEP_ALIVE_TIMEOUT_MS,
      shutdownGraceMs: e.SHUTDOWN_GRACE_MS,
      maxHeaderBytes: 16 * 1024,
    }),
  });
}

/** Safe summary for startup logging: no secret material. */
export function describeConfig(c: AppConfig): Record<string, unknown> {
  return {
    nodeEnv: c.nodeEnv,
    host: c.host,
    port: c.port,
    appOrigin: c.appOrigin,
    appSecretConfigured: c.appSecret !== null,
    backupKeyConfigured: c.backupKey !== null,
    trustProxyCount: c.trustProxy.length,
    logLevel: c.logLevel,
  };
}
