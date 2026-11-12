import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A unique marker planted in files that must never be served. */
export const CANARY = `CANARY-${randomBytes(12).toString('hex')}`;

export interface TempApp {
  root: string;
  distDir: string;
  migrationsDir: string;
  databasePath: string;
  cleanup(): Promise<void>;
}

/**
 * Builds the real application into a disposable app root laid out like a
 * release (dist/ + migrations/, no node_modules, no .git), initializes its
 * database through the real CLI, and plants a canary in sensitive-looking files
 * (.env, package.json, source) and in the database itself, so tests can prove
 * none of them is reachable over HTTP.
 */
export async function createTempApp(options: { initDb?: boolean } = {}): Promise<TempApp> {
  const root = await mkdtemp(path.join(tmpdir(), 'alkhayr-test-'));
  const distDir = path.join(root, 'dist');
  const migrationsDir = path.join(root, 'migrations');
  const databasePath = path.join(root, 'data', 'alkhayr.db');
  const buildModule = (await import(path.join(projectRoot, 'scripts', 'build.mjs'))) as {
    build(opts: { dev?: boolean; outDir: string }): Promise<unknown>;
  };
  await buildModule.build({ dev: false, outDir: distDir });
  await cp(path.join(projectRoot, 'migrations'), migrationsDir, { recursive: true });
  await writeFile(path.join(root, '.env'), `APP_SECRET=${CANARY}\n`);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: CANARY }));
  await mkdir(path.join(root, 'src', 'server'), { recursive: true });
  await writeFile(path.join(root, 'src', 'server', 'main.ts'), `// ${CANARY}`);
  await writeFile(path.join(distDir, 'web', 'secret.txt'), CANARY); // present in web dir but NOT in manifest
  const app: TempApp = { root, distDir, migrationsDir, databasePath, cleanup: () => rm(root, { recursive: true, force: true }) };
  if (options.initDb !== false) {
    const init = await runCli(app, ['db:init']);
    if (init.code !== 0) throw new Error(`db:init failed: ${init.stdout}\n${init.stderr}`);
    // Canary inside the database (company name), to detect any file leak.
    const db = new DatabaseSync(databasePath);
    db.prepare('UPDATE business_settings SET company_name = ?, version = version + 1 WHERE id = 1').run(CANARY);
    db.close();
  }
  return app;
}

/** Runs the bundled operator CLI of a temp app. */
export function runCli(app: TempApp, args: string[], env: NodeJS.ProcessEnv = baseEnv()): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [path.join(app.distDir, 'server', 'cli.js'), ...args], { cwd: app.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  return new Promise((resolve) => child.once('exit', (code) => resolve({ code, stdout, stderr })));
}

export interface RunningServer {
  port: number;
  host: string;
  child: ChildProcess;
  stdout: () => string;
  stderr: () => string;
  stop(signal?: NodeJS.Signals): Promise<number | null>;
}

export const TEST_HOST = 'alkhayr.test';

/** Disposable per-process fixture secrets (tests only; never used anywhere else). */
export const FIXTURE_APP_SECRET = randomBytes(32).toString('base64url');
export const FIXTURE_BACKUP_KEY = randomBytes(32).toString('base64url');

export function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  // Do not inherit the developer's environment (could contain real secrets).
  // Pass APP_SECRET: '' (empty = unset) to test missing-secret behaviour.
  return {
    PATH: process.env.PATH ?? '',
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '0',
    APP_ORIGIN: `http://${TEST_HOST}`,
    LOG_LEVEL: 'info',
    APP_SECRET: FIXTURE_APP_SECRET,
    BACKUP_KEY: FIXTURE_BACKUP_KEY,
    ...extra,
  };
}

export function startServer(app: TempApp, env: NodeJS.ProcessEnv = baseEnv()): Promise<RunningServer> {
  const child = spawn(process.execPath, [path.join(app.distDir, 'server', 'main.js')], {
    cwd: app.root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  let err = '';
  child.stdout!.setEncoding('utf8').on('data', (d: string) => (out += d));
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not start:\n${out}\n${err}`)), 10_000);
    const onData = () => {
      for (const line of out.split('\n')) {
        if (!line.includes('"event":"listening"')) continue;
        const port = (JSON.parse(line) as { port: number }).port;
        clearTimeout(timer);
        child.stdout!.off('data', onData);
        resolve({
          port,
          host: TEST_HOST,
          child,
          stdout: () => out,
          stderr: () => err,
          stop: (signal = 'SIGTERM') => {
            if (child.exitCode === null) child.kill(signal);
            return exited;
          },
        });
        return;
      }
    };
    child.stdout!.on('data', onData);
    void exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with ${code}:\n${out}\n${err}`));
    });
  });
}

/** Runs the server expecting it to exit (e.g. invalid configuration). */
export function runUntilExit(app: TempApp, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [path.join(app.distDir, 'server', 'main.js')], { cwd: app.root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d));
  child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d));
  const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
  return new Promise((resolve) =>
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    }),
  );
}

export interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** HTTP request with a verbatim path and explicit Host (fetch normalizes both). */
export function rawRequest(
  port: number,
  options: { method?: string; path: string; headers?: Record<string, string>; body?: string | Buffer },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path, headers: { Host: TEST_HOST, ...options.headers }, agent: false },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (body += d));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on('error', reject);
    req.end(options.body);
  });
}
