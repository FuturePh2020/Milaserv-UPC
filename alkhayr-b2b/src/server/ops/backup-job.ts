import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { readSecretFile } from '../config.ts';
import { BackupError, createBackup, decryptBackup, openStaging, pruneBackups, readKeyFile, verifyDatabaseFile } from '../backup/backup.ts';
import { DatabaseError } from '../database/errors.ts';
import { acquireInstanceLock } from '../database/instance-lock.ts';
import type { Migration } from '../database/migrations.ts';
import { assertTimeZone, parseDailyTimes, type DailyTime } from './schedule.ts';
import { fileSha256, S3Client, S3Error, type S3Config } from './s3.ts';

/**
 * Scheduled encrypted backup job (stage 17). One run:
 *   1. non-overlap lock (an OS lock on BACKUP_DIR/.job; a second run is skipped, not queued);
 *   2. `createBackup` — the SAME verified encrypted format as `backup:create` (snapshot → verify → encrypt →
 *      re-verify the final file); bounded retries for transient failures only;
 *   3. rotation with `pruneBackups` (always keeps the newest verified backup);
 *   4. off-server copy when configured, ONLY after local verification: upload (payload hash signed,
 *      SHA-256 checksum sent) → HEAD size/checksum → download into a 0600 temp file → SHA-256 equals the
 *      local file → decrypt into private staging → full consistency verification. Only then is the copy
 *      recorded as verified. An upload response alone never counts.
 *   5. status file BACKUP_DIR/status/backup-job.json (0600, atomic) for monitoring — no secrets.
 * The backup key and the storage credentials are read from protected FILES given by the configuration;
 * nothing secret is accepted from arguments or written to logs/status.
 */

export interface OffsiteSettings extends Omit<S3Config, 'accessKeyId' | 'secretAccessKey'> {
  accessKeyFile: string;
  secretKeyFile: string;
}

export interface JobSettings {
  keyFile: string;
  times: DailyTime[];
  timeZone: string;
  keep: number;
  retries: number;
  retryDelayMs: number;
  offsite: OffsiteSettings | null;
}

const bool = z.enum(['0', '1', 'true', 'false']).transform((v) => v === '1' || v === 'true');
const jobEnv = z.object({
  BACKUP_KEY_FILE: z.string().min(1, 'BACKUP_KEY_FILE is required for scheduled backups'),
  BACKUP_SCHEDULE: z.string().default('02:17'),
  BACKUP_TZ: z.string().default('Africa/Cairo'),
  BACKUP_KEEP: z.coerce.number().int().min(1).max(1000).default(14),
  BACKUP_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  BACKUP_RETRY_DELAY_SECONDS: z.coerce.number().int().min(1).max(3600).default(60),
  OFFSITE_S3_ENDPOINT: z.string().optional(),
  OFFSITE_S3_REGION: z.string().regex(/^[a-z0-9-]{2,32}$/).optional(),
  OFFSITE_S3_BUCKET: z.string().optional(),
  OFFSITE_S3_PREFIX: z.string().max(200).default(''),
  OFFSITE_S3_PATH_STYLE: bool.default(false),
  OFFSITE_S3_ACCESS_KEY_FILE: z.string().optional(),
  OFFSITE_S3_SECRET_KEY_FILE: z.string().optional(),
  /** Local testing only: allows an http:// endpoint (e.g. a disposable S3-compatible test server). */
  OFFSITE_S3_ALLOW_HTTP: bool.default(false),
});

export function loadJobSettings(env: NodeJS.ProcessEnv): JobSettings {
  const clean = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const r = jobEnv.safeParse(clean);
  if (!r.success) throw new BackupError('CONFIG_INVALID', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const e = r.data;
  const times = parseDailyTimes(e.BACKUP_SCHEDULE);
  const timeZone = assertTimeZone(e.BACKUP_TZ);
  const offsiteKeys = ['OFFSITE_S3_ENDPOINT', 'OFFSITE_S3_REGION', 'OFFSITE_S3_BUCKET', 'OFFSITE_S3_ACCESS_KEY_FILE', 'OFFSITE_S3_SECRET_KEY_FILE'] as const;
  const present = offsiteKeys.filter((k) => e[k] !== undefined);
  let offsite: OffsiteSettings | null = null;
  if (present.length > 0) {
    if (present.length !== offsiteKeys.length) throw new BackupError('CONFIG_INVALID', `Off-server storage is partly configured; set all of: ${offsiteKeys.join(', ')}`);
    const u = new URL(e.OFFSITE_S3_ENDPOINT!);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && e.OFFSITE_S3_ALLOW_HTTP)) throw new BackupError('CONFIG_INVALID', 'OFFSITE_S3_ENDPOINT must be https://');
    if (e.OFFSITE_S3_PREFIX && !/^[A-Za-z0-9._/-]+\/$/.test(e.OFFSITE_S3_PREFIX)) throw new BackupError('CONFIG_INVALID', 'OFFSITE_S3_PREFIX must end with "/" and use A-Z a-z 0-9 . _ - /');
    offsite = {
      endpoint: u.origin,
      region: e.OFFSITE_S3_REGION!,
      bucket: e.OFFSITE_S3_BUCKET!,
      prefix: e.OFFSITE_S3_PREFIX,
      pathStyle: e.OFFSITE_S3_PATH_STYLE,
      accessKeyFile: e.OFFSITE_S3_ACCESS_KEY_FILE!,
      secretKeyFile: e.OFFSITE_S3_SECRET_KEY_FILE!,
    };
  }
  return { keyFile: e.BACKUP_KEY_FILE, times, timeZone, keep: e.BACKUP_KEEP, retries: e.BACKUP_RETRIES, retryDelayMs: e.BACKUP_RETRY_DELAY_SECONDS * 1000, offsite };
}

export interface JobStatus {
  version: 1;
  lastAttemptAt: number;
  lastResult: 'ok' | 'failed' | 'skipped_overlap';
  lastErrorCode: string | null;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  local: { file: string; verifiedAt: number } | null;
  offsite: { configured: boolean; objectKey: string | null; verifiedAt: number | null; bytes: number | null; lastErrorCode: string | null };
}

export const statusFile = (backupDir: string) => path.join(backupDir, 'status', 'backup-job.json');

export function readJobStatus(backupDir: string): JobStatus | null {
  try {
    return JSON.parse(readFileSync(statusFile(backupDir), 'utf8')) as JobStatus;
  } catch {
    return null;
  }
}

function writeJobStatus(backupDir: string, s: JobStatus): void {
  const dir = path.dirname(statusFile(backupDir));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.backup-job.${randomBytes(6).toString('hex')}.tmp`);
  writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600, flag: 'wx' });
  renameSync(tmp, statusFile(backupDir));
}

/** Failures that retrying cannot fix (configuration, keys, data). */
const FATAL = new Set(['KEY_FILE_MISSING', 'KEY_FILE_INSECURE', 'KEY_FILE_LOCATION', 'KEY_FILE_INVALID', 'APP_SECRET_MISMATCH', 'INVARIANT_FAILED', 'SCHEMA_INCOMPATIBLE', 'DB_CORRUPT', 'DB_FOREIGN', 'DB_UNREADABLE', 'DATABASE_MISSING', 'CONFIG_INVALID', 'DISK_FULL']);
const codeOf = (err: unknown) => (err instanceof BackupError || err instanceof DatabaseError ? err.code : err instanceof S3Error ? `OFFSITE_HTTP_${err.status}${err.s3Code ? `_${err.s3Code}` : ''}` : 'UNEXPECTED');

export interface JobContext {
  settings: JobSettings;
  backupDir: string;
  dataDir: string;
  databasePath: string;
  appSecret: Buffer | null;
  migrations: readonly Migration[];
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  log: (event: string, fields?: Record<string, string | number | boolean | null>) => void;
}

async function withRetries<T>(ctx: JobContext, what: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = codeOf(err);
      const retriable = !FATAL.has(code) && !(err instanceof S3Error && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429);
      if (!retriable || attempt >= ctx.settings.retries) throw err;
      ctx.log('backup_job_retry', { step: what, attempt: attempt + 1, code });
      await ctx.sleep(ctx.settings.retryDelayMs * (attempt + 1));
    }
  }
}

/** Upload, then prove the remote copy: size/checksum, download, byte-for-byte hash, decrypt, verify. */
export async function copyOffsiteAndVerify(ctx: JobContext, file: string, backupKey: Buffer): Promise<{ objectKey: string; bytes: number }> {
  const o = ctx.settings.offsite!;
  const access = readSecretFile('OFFSITE_S3_ACCESS_KEY_FILE', o.accessKeyFile);
  const secret = readSecretFile('OFFSITE_S3_SECRET_KEY_FILE', o.secretKeyFile);
  if (!access.ok || !secret.ok) throw new BackupError('CONFIG_INVALID', `${!access.ok ? access.issue : ''} ${!secret.ok ? secret.issue : ''}`.trim());
  const s3 = new S3Client({ endpoint: o.endpoint, region: o.region, bucket: o.bucket, prefix: o.prefix, pathStyle: o.pathStyle, accessKeyId: access.value, secretAccessKey: secret.value });
  const name = path.basename(file);
  const objectKey = s3.key(name);
  const local = await fileSha256(file);
  await withRetries(ctx, 'offsite_upload', () => s3.putFile(objectKey, file, local));
  const head = await withRetries(ctx, 'offsite_head', () => s3.head(objectKey));
  if (head.bytes !== local.bytes) throw new BackupError('OFFSITE_MISMATCH', 'The off-server object size differs from the local backup.');
  if (head.sha256Base64 !== null && head.sha256Base64 !== local.base64) throw new BackupError('OFFSITE_MISMATCH', 'The off-server object checksum differs from the local backup.');
  // Download into a protected temporary file (ciphertext), named like an interrupted partial so leftovers are cleaned.
  const download = path.join(ctx.backupDir, `.${name}.partial`);
  rmSync(download, { force: true });
  try {
    const got = await withRetries(ctx, 'offsite_download', async () => {
      rmSync(download, { force: true });
      return s3.getToFile(objectKey, download);
    });
    if (got.hex !== local.hex || got.bytes !== local.bytes) throw new BackupError('OFFSITE_MISMATCH', 'The downloaded copy differs from the local backup.');
    const staging = openStaging(ctx.dataDir);
    try {
      const target = path.join(staging.dir, 'verify.db');
      await decryptBackup(download, backupKey, target);
      verifyDatabaseFile(target, { migrations: ctx.migrations, appSecret: ctx.appSecret });
    } finally {
      staging.dispose();
    }
  } finally {
    rmSync(download, { force: true });
  }
  return { objectKey, bytes: local.bytes };
}

export async function runBackupJob(ctx: JobContext): Promise<JobStatus> {
  const previous = readJobStatus(ctx.backupDir);
  const base: JobStatus = {
    version: 1,
    lastAttemptAt: ctx.now(),
    lastResult: 'failed',
    lastErrorCode: null,
    consecutiveFailures: previous?.consecutiveFailures ?? 0,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    local: previous?.local ?? null,
    offsite: previous?.offsite ?? { configured: ctx.settings.offsite !== null, objectKey: null, verifiedAt: null, bytes: null, lastErrorCode: null },
  };
  base.offsite = { ...base.offsite, configured: ctx.settings.offsite !== null };
  mkdirSync(ctx.backupDir, { recursive: true, mode: 0o700 });
  let lock;
  try {
    lock = acquireInstanceLock(path.join(ctx.backupDir, '.job'), 'the backup job');
  } catch (err) {
    if (err instanceof DatabaseError && err.code === 'INSTANCE_LOCKED') {
      ctx.log('backup_job_skipped', { reason: 'previous run still active' });
      const s = { ...base, lastResult: 'skipped_overlap' as const, lastErrorCode: null };
      return s; // the running job owns the status file
    }
    throw err;
  }
  let key: Buffer | null = null;
  try {
    key = readKeyFile(path.resolve(ctx.settings.keyFile), [ctx.dataDir, ctx.backupDir]);
    const created = await withRetries(ctx, 'create', () =>
      createBackup({ databasePath: ctx.databasePath, dataDir: ctx.dataDir, backupDir: ctx.backupDir, backupKey: key!, appSecret: ctx.appSecret, migrations: ctx.migrations, now: ctx.now }),
    );
    const local = { file: path.basename(created.file), verifiedAt: ctx.now() };
    ctx.log('backup_job_local_verified', { file: local.file });
    const pruned = await pruneBackups(ctx.backupDir, ctx.settings.keep);
    if (pruned.deleted.length) ctx.log('backup_job_rotated', { deleted: pruned.deleted.length, kept: pruned.kept.length });
    let offsite = base.offsite;
    if (ctx.settings.offsite) {
      try {
        const r = await copyOffsiteAndVerify(ctx, created.file, key);
        offsite = { configured: true, objectKey: r.objectKey, verifiedAt: ctx.now(), bytes: r.bytes, lastErrorCode: null };
        ctx.log('backup_job_offsite_verified', { object: r.objectKey });
      } catch (err) {
        offsite = { ...offsite, configured: true, lastErrorCode: codeOf(err) };
        const s: JobStatus = { ...base, lastResult: 'failed', lastErrorCode: codeOf(err), consecutiveFailures: base.consecutiveFailures + 1, local, offsite };
        writeJobStatus(ctx.backupDir, s);
        ctx.log('backup_job_failed', { step: 'offsite', code: codeOf(err) });
        return s;
      }
    }
    const s: JobStatus = { ...base, lastResult: 'ok', lastErrorCode: null, consecutiveFailures: 0, lastSuccessAt: ctx.now(), local, offsite };
    writeJobStatus(ctx.backupDir, s);
    ctx.log('backup_job_ok', { file: local.file, offsite: ctx.settings.offsite ? 'verified' : 'not_configured' });
    return s;
  } catch (err) {
    const s: JobStatus = { ...base, lastResult: 'failed', lastErrorCode: codeOf(err), consecutiveFailures: base.consecutiveFailures + 1 };
    writeJobStatus(ctx.backupDir, s);
    ctx.log('backup_job_failed', { step: 'local', code: codeOf(err) });
    return s;
  } finally {
    key?.fill(0);
    lock.release();
    if (existsSync(path.join(ctx.backupDir, '.job'))) {
      /* lock directory stays (contains only the lock file) */
    }
  }
}
