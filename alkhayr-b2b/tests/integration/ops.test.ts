import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ConfigError, loadConfig } from '../../src/server/config.ts';
import { runCli } from '../../src/server/cli/index.ts';
import { acquireInstanceLock } from '../../src/server/database/instance-lock.ts';
import { loadJobSettings, readJobStatus, runBackupJob, type JobContext } from '../../src/server/ops/backup-job.ts';
import { nextRun, parseDailyTimes } from '../../src/server/ops/schedule.ts';
import { loadMigrations } from '../../src/server/database/migrations.ts';
import { createAdmin, startTestApp, type TestApp } from '../helpers/app.ts';
import { insertProduct, MIGRATIONS_DIR, tempDir } from '../helpers/database.ts';
import { scriptedPrompter } from '../helpers/prompter.ts';

// Stage 17: secret files, scheduling, the scheduled backup job and off-server failure handling,
// monitoring status. Disposable apps, directories and a disposable local fake object store only.

describe('APP_SECRET_FILE', () => {
  const base = { NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example.test' };
  const secret = randomBytes(32).toString('base64url');
  const file = (mode: number, content = `${secret}\n`) => {
    const dir = tempDir('alkhayr-secret-');
    const f = path.join(dir, 'app_secret');
    writeFileSync(f, content);
    chmodSync(f, mode);
    return f;
  };
  test('a protected file is accepted (trailing newline removed); permissive, missing, ambiguous or placeholder files are refused', () => {
    const ok = loadConfig({ ...base, APP_SECRET_FILE: file(0o400) }, { baseDir: '/' });
    assert.equal(ok.appSecret!.toString('base64url'), secret);
    assert.ok(loadConfig({ ...base, APP_SECRET_FILE: file(0o440) }, { baseDir: '/' }).appSecret);
    const issues = (env: Record<string, string>) => {
      try {
        loadConfig({ ...base, ...env }, { baseDir: '/' });
        return [];
      } catch (e) {
        return (e as ConfigError).issues;
      }
    };
    assert.match(issues({ APP_SECRET_FILE: file(0o644) }).join(), /not be readable by others/);
    assert.match(issues({ APP_SECRET_FILE: file(0o460) }).join(), /not be writable by group/);
    assert.match(issues({ APP_SECRET_FILE: '/nonexistent/app_secret' }).join(), /does not exist/);
    assert.match(issues({ APP_SECRET_FILE: file(0o400), APP_SECRET: secret }).join(), /exactly one of APP_SECRET or APP_SECRET_FILE/);
    assert.match(issues({ APP_SECRET_FILE: file(0o400, 'change-me-please-change-me-please-x\n') }).join(), /placeholder/);
    assert.match(issues({ APP_SECRET_FILE: path.dirname(file(0o400)) }).join(), /not a regular file/);
    const all = issues({ APP_SECRET_FILE: file(0o644) }).join();
    assert.ok(!all.includes(secret), 'the secret value never appears in errors');
    assert.match(issues({}).join(), /APP_SECRET is required in production/);
  });
});

describe('daily schedule', () => {
  test('local times in an IANA zone, next run strictly after now, DST gap/repeat handled once', () => {
    const t = parseDailyTimes('14:17,02:17');
    assert.equal(new Date(nextRun(Date.UTC(2026, 10, 13, 0, 0), t, 'Africa/Cairo')).toISOString(), '2026-11-13T00:17:00.000Z');
    assert.equal(new Date(nextRun(Date.UTC(2026, 10, 13, 0, 17), t, 'Africa/Cairo')).toISOString(), '2026-11-13T12:17:00.000Z');
    assert.equal(new Date(nextRun(Date.UTC(2026, 10, 1, 4, 0), parseDailyTimes('01:30'), 'America/New_York')).toISOString(), '2026-11-01T05:30:00.000Z', 'fall-back: first occurrence only');
    const gap = nextRun(Date.UTC(2026, 2, 8, 5, 0), parseDailyTimes('02:30'), 'America/New_York');
    assert.ok(gap >= Date.UTC(2026, 2, 8, 7, 0) && gap <= Date.UTC(2026, 2, 8, 8, 0), 'spring-forward gap: runs within the hour after the gap');
    for (const bad of ['', '24:00', '2:17', '02:17,xx']) assert.throws(() => parseDailyTimes(bad));
    assert.throws(() => loadJobSettings({ BACKUP_KEY_FILE: '/k', BACKUP_TZ: 'Mars/Olympus' }), /time zone/);
  });
});

/** Disposable local fake object store (NOT S3-compatible auth; used for failure-mode tests only). */
async function fakeStore(mode: { failFirst?: number; status?: number; corrupt?: boolean; wrongSize?: boolean } = {}) {
  const objects = new Map<string, Buffer>();
  let failures = mode.failFirst ?? 0;
  const calls: string[] = [];
  const server: Server = createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    if (!String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256 Credential=AKTEST/')) {
      res.writeHead(403).end('<Error><Code>AccessDenied</Code></Error>');
      return;
    }
    if (mode.status) {
      res.writeHead(mode.status).end('<Error><Code>Forced</Code></Error>');
      return;
    }
    if (failures > 0) {
      failures--;
      res.writeHead(503).end('<Error><Code>SlowDown</Code></Error>');
      return;
    }
    const key = req.url!;
    if (req.method === 'PUT') {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        if (createHash('sha256').update(body).digest('hex') !== req.headers['x-amz-content-sha256']) return void res.writeHead(400).end('<Error><Code>XAmzContentSHA256Mismatch</Code></Error>');
        objects.set(key, body);
        res.writeHead(200).end();
      });
      return;
    }
    const obj = objects.get(key);
    if (!obj) return void res.writeHead(404).end('<Error><Code>NoSuchKey</Code></Error>');
    if (req.method === 'HEAD') return void res.writeHead(200, { 'content-length': String(mode.wrongSize ? obj.length + 1 : obj.length) }).end();
    const out = Buffer.from(obj);
    if (mode.corrupt) out[out.length - 20] = out[out.length - 20]! ^ 0xff;
    res.writeHead(200, { 'content-length': String(out.length) }).end(out);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { port, objects, calls, close: () => new Promise<void>((r) => server.close(() => r())) };
}

async function withJob(fn: (a: { app: TestApp; work: string; ctx: (env?: Record<string, string>) => JobContext; logs: string[]; credDir: string }) => Promise<void>) {
  const app = await startTestApp();
  const work = tempDir('alkhayr-job-');
  try {
    await createAdmin(app);
    insertProduct(app.fixtureDb, { onHand: 20 });
    const keyDir = path.join(work, 'keys');
    mkdirSync(keyDir, { mode: 0o700 });
    const config = { ...app.config, backupDir: path.join(work, 'backups') };
    const out: string[] = [];
    const code = await runCli(['backup:keygen', '--out', path.join(keyDir, 'backup.key')], { config, migrationsDir: MIGRATIONS_DIR, io: { out: (l) => void out.push(l), err: (l) => void out.push(l) }, createPrompter: () => scriptedPrompter([]) });
    assert.equal(code, 0, out.join('\n'));
    const credDir = path.join(work, 'creds');
    mkdirSync(credDir, { mode: 0o700 });
    writeFileSync(path.join(credDir, 'access'), 'AKTEST\n', { mode: 0o400 });
    writeFileSync(path.join(credDir, 'secret'), 'not-a-real-secret-test-only\n', { mode: 0o400 });
    const logs: string[] = [];
    const ctx = (env: Record<string, string> = {}): JobContext => ({
      settings: loadJobSettings({ BACKUP_KEY_FILE: path.join(keyDir, 'backup.key'), BACKUP_RETRY_DELAY_SECONDS: '1', ...env }),
      backupDir: config.backupDir,
      dataDir: app.config.dataDir,
      databasePath: app.config.databasePath,
      appSecret: app.config.appSecret,
      migrations: loadMigrations(MIGRATIONS_DIR),
      now: Date.now,
      sleep: async () => undefined,
      log: (event, fields = {}) => void logs.push(JSON.stringify({ event, ...fields })),
    });
    await fn({ app, work, ctx, logs, credDir });
  } finally {
    await app.close();
  }
}

const offsiteEnv = (port: number, credDir: string, prefix = 'alkhayr/staging/') => ({
  OFFSITE_S3_ENDPOINT: `http://127.0.0.1:${port}`,
  OFFSITE_S3_ALLOW_HTTP: '1',
  OFFSITE_S3_REGION: 'test-1',
  OFFSITE_S3_BUCKET: 'alkhayr-test',
  OFFSITE_S3_PREFIX: prefix,
  OFFSITE_S3_PATH_STYLE: '1',
  OFFSITE_S3_ACCESS_KEY_FILE: path.join(credDir, 'access'),
  OFFSITE_S3_SECRET_KEY_FILE: path.join(credDir, 'secret'),
});

describe('scheduled backup job', () => {
  test('local-only run: verified backup, rotation, status file; overlapping run skipped; fatal failure not retried', () =>
    withJob(async ({ ctx, logs, work }) => {
      const s = await runBackupJob(ctx({ BACKUP_KEEP: '2' }));
      assert.equal(s.lastResult, 'ok');
      assert.equal(s.offsite.configured, false);
      const status = readJobStatus(path.join(work, 'backups'))!;
      assert.equal(status.local!.file, s.local!.file);
      assert.ok(existsSync(path.join(work, 'backups', `${s.local!.file}.verified`)));
      // Overlap: a run while another holds the job lock is skipped, not queued.
      const lock = acquireInstanceLock(path.join(work, 'backups', '.job'), 'test');
      try {
        assert.equal((await runBackupJob(ctx())).lastResult, 'skipped_overlap');
      } finally {
        lock.release();
      }
      // Fatal failure (missing key file): no retries, failure recorded, previous good backup untouched.
      logs.length = 0;
      const bad = await runBackupJob({ ...ctx(), settings: { ...ctx().settings, keyFile: path.join(work, 'missing.key') } });
      assert.equal(bad.lastResult, 'failed');
      assert.equal(bad.lastErrorCode, 'KEY_FILE_MISSING');
      assert.equal(bad.consecutiveFailures, 1);
      assert.ok(!logs.some((l) => l.includes('backup_job_retry')));
      assert.equal(readJobStatus(path.join(work, 'backups'))!.local!.file, s.local!.file, 'last good backup still recorded');
      for (let i = 0; i < 3; i++) await runBackupJob(ctx({ BACKUP_KEEP: '2' }));
      const files = readdirSync(path.join(work, 'backups')).filter((n) => n.endsWith('.akbk'));
      assert.equal(files.length, 2, 'rotation keeps the configured number of generations');
      assert.equal(readJobStatus(path.join(work, 'backups'))!.consecutiveFailures, 0);
      const statusText = readFileSync(path.join(work, 'backups', 'status', 'backup-job.json'), 'utf8');
      assert.doesNotMatch(statusText, /BEGIN|secret|key=/i);
    }));

  test('off-server copy is verified by download, hash, decryption and consistency check — not by the upload response', () =>
    withJob(async ({ ctx, credDir, work }) => {
      const store = await fakeStore();
      try {
        const s = await runBackupJob(ctx(offsiteEnv(store.port, credDir)));
        assert.equal(s.lastResult, 'ok', JSON.stringify(s));
        assert.ok(s.offsite.verifiedAt);
        assert.equal(s.offsite.objectKey, `alkhayr/staging/${s.local!.file}`);
        assert.deepEqual(store.calls.map((c) => c.split(' ')[0]), ['PUT', 'HEAD', 'GET']);
        assert.ok(!readdirSync(path.join(work, 'backups')).some((n) => n.endsWith('.partial')), 'download temp removed');
      } finally {
        await store.close();
      }
    }));

  test('destination failures: unavailable, transient 503 (bounded retries), 403 (no retry), corrupted download, wrong size — local backup stays verified', () =>
    withJob(async ({ ctx, credDir, logs, work }) => {
      // Unavailable destination (nothing listening).
      const dead = await fakeStore();
      await dead.close();
      let s = await runBackupJob(ctx({ ...offsiteEnv(dead.port, credDir), BACKUP_RETRIES: '2' }));
      assert.equal(s.lastResult, 'failed');
      assert.match(s.lastErrorCode!, /^OFFSITE_HTTP_0/);
      assert.ok(s.local, 'the local backup was still created and verified');
      assert.equal(s.offsite.verifiedAt, null);
      assert.equal(logs.filter((l) => l.includes('backup_job_retry') && l.includes('offsite_upload')).length, 2, 'bounded retries');
      // Transient 503s then success.
      const flaky = await fakeStore({ failFirst: 2 });
      try {
        s = await runBackupJob(ctx({ ...offsiteEnv(flaky.port, credDir), BACKUP_RETRIES: '2' }));
        assert.equal(s.lastResult, 'ok', JSON.stringify(s));
        assert.equal(s.consecutiveFailures, 0);
      } finally {
        await flaky.close();
      }
      // Permanent 403: not retried.
      logs.length = 0;
      const denied = await fakeStore({ status: 403 });
      try {
        s = await runBackupJob(ctx(offsiteEnv(denied.port, credDir)));
        assert.equal(s.lastErrorCode, 'OFFSITE_HTTP_403_Forced');
        assert.equal(logs.filter((l) => l.includes('backup_job_retry')).length, 0);
      } finally {
        await denied.close();
      }
      for (const mode of [{ corrupt: true }, { wrongSize: true }]) {
        const st = await fakeStore(mode);
        try {
          s = await runBackupJob(ctx(offsiteEnv(st.port, credDir)));
          assert.equal(s.lastResult, 'failed');
          assert.equal(s.lastErrorCode, 'OFFSITE_MISMATCH', JSON.stringify(mode));
        } finally {
          await st.close();
        }
      }
      assert.ok(!readdirSync(path.join(work, 'backups')).some((n) => n.endsWith('.partial')));
      // Partial configuration is refused outright.
      assert.throws(() => loadJobSettings({ BACKUP_KEY_FILE: '/k', OFFSITE_S3_BUCKET: 'b' }), /partly configured/);
      assert.throws(() => loadJobSettings({ BACKUP_KEY_FILE: '/k', ...offsiteEnv(1, credDir), OFFSITE_S3_ALLOW_HTTP: '0' }), /must be https/);
    }));
});

describe('ops:status', () => {
  test('critical without any verified backup; warning in recovery mode / without off-server copy; JSON only, no secrets', () =>
    withJob(async ({ app, ctx, work }) => {
      const config = { ...app.config, backupDir: path.join(work, 'backups') };
      const run = async () => {
        const out: string[] = [];
        const code = await runCli(['ops:status'], { config, migrationsDir: MIGRATIONS_DIR, io: { out: (l) => void out.push(l), err: (l) => void out.push(l) } });
        return { code, json: JSON.parse(out.join('\n')) as { overall: string; checks: Array<{ name: string; status: string; detail: string }> } };
      };
      let r = await run();
      assert.equal(r.code, 1);
      assert.equal(r.json.checks.find((c) => c.name === 'local_backup')!.status, 'critical');
      await runBackupJob(ctx());
      r = await run();
      assert.equal(r.code, 3, JSON.stringify(r.json));
      assert.equal(r.json.checks.find((c) => c.name === 'offsite_copy')!.status, 'warn');
      assert.equal(r.json.checks.find((c) => c.name === 'writes')!.status, 'ok');
      app.fixtureDb.prepare("UPDATE system_state SET write_mode = 'recovery', recovery_epoch = 5, recovery_started_at = 1, version = version + 1").run();
      r = await run();
      assert.match(r.json.checks.find((c) => c.name === 'writes')!.detail, /RECOVERY MODE/);
      assert.doesNotMatch(JSON.stringify(r.json), new RegExp(app.config.appSecret!.toString('base64url')));
    }));
});

describe('backup:schedule', () => {
  test('stops promptly on SIGTERM while waiting for the next run (no lingering timer)', () =>
    withJob(async ({ app, work }) => {
      const { EventEmitter } = await import('node:events');
      const signals = new EventEmitter();
      const { backupSchedule } = await import('../../src/server/cli/operator.ts');
      const out: string[] = [];
      const ctx = { config: { ...app.config, backupDir: path.join(work, 'backups') }, migrationsDir: MIGRATIONS_DIR, out: (l: string) => void out.push(l), err: (l: string) => void out.push(l), prompter: () => scriptedPrompter([]) };
      const env = { BACKUP_KEY_FILE: path.join(work, 'keys', 'backup.key'), BACKUP_SCHEDULE: '03:00', BACKUP_TZ: 'UTC' };
      const timers = () => process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
      const timersBefore = timers();
      const started = Date.now();
      const running = backupSchedule(ctx as never, [], env, signals);
      await new Promise((r) => setTimeout(r, 200));
      signals.emit('SIGTERM');
      assert.equal(await running, 0);
      assert.ok(Date.now() - started < 2000, `stopped after ${Date.now() - started} ms`);
      assert.ok(timers() <= timersBefore, 'no pending sleep timer keeps the stopped scheduler process alive');
      assert.ok(out.some((l) => l.includes('backup_scheduler_stopped')));
      assert.ok(out.some((l) => l.includes('backup_next_run')));
    }));
});
