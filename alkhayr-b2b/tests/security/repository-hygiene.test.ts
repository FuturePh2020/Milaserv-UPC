import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { projectRoot } from '../helpers/server.ts';

const read = (f: string) => readFileSync(path.join(projectRoot, f), 'utf8');

// Evaluate .gitignore in a throwaway repository so the test also works from a
// source archive that has no .git directory.
function withIgnoreRepo<T>(fn: (ignored: (p: string) => boolean) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'alkhayr-gitignore-'));
  try {
    copyFileSync(path.join(projectRoot, '.gitignore'), path.join(dir, '.gitignore'));
    execFileSync('git', ['init', '-q'], { cwd: dir, stdio: 'ignore' });
    return fn((p) => {
      try {
        execFileSync('git', ['check-ignore', '-q', '--no-index', p], { cwd: dir, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('.gitignore excludes secrets, data, backups, dependencies and build output', () => withIgnoreRepo((gitIgnored) => {
  for (const p of ['.env', '.env.production', 'data/alkhayr.db', 'data/alkhayr.db-wal', 'backups/2026.enc', 'x.sqlite', 'node_modules/react/index.js', 'dist/server/main.js', 'release/a.tgz', 'server.key', 'tls.pem', '.tmp/state']) {
    assert.ok(gitIgnored(p), `${p} should be ignored`);
  }
  for (const p of ['.env.example', 'src/server/main.ts', 'migrations/0001_initial.sql', 'package-lock.json']) {
    assert.ok(!gitIgnored(p), `${p} must not be ignored`);
  }
}));

test('.dockerignore excludes secrets, data, backups, VCS and dependencies', () => {
  const lines = new Set(read('.dockerignore').split('\n').map((l) => l.trim()));
  for (const entry of ['.git', '.env', '.env.*', 'data', 'backups', 'node_modules', 'dist', '*.db', '*.db-wal', '*.enc', '*.pem', '*.key']) {
    assert.ok(lines.has(entry), `.dockerignore missing ${entry}`);
  }
});

test('.env.example holds placeholders only and documents every config variable', () => {
  const text = read('.env.example');
  assert.match(text, /^APP_SECRET=$/m);
  assert.match(text, /^BACKUP_KEY=$/m);
  for (const line of text.split('\n')) {
    if (line.startsWith('#') || !line.includes('=')) continue;
    const value = line.slice(line.indexOf('=') + 1);
    assert.ok(!/^[A-Za-z0-9_-]{40,}$/.test(value), `suspicious secret-like value in ${line.split('=')[0]}`);
  }
  for (const name of ['NODE_ENV', 'HOST', 'PORT', 'APP_ORIGIN', 'DATA_DIR', 'BACKUP_DIR', 'TRUST_PROXY', 'LOG_LEVEL', 'HTTP_HEADERS_TIMEOUT_MS', 'HTTP_REQUEST_TIMEOUT_MS', 'HTTP_KEEP_ALIVE_TIMEOUT_MS', 'SHUTDOWN_GRACE_MS']) {
    assert.match(text, new RegExp(`^${name}=`, 'm'), name);
  }
});

test('no ChatGPT/OpenAI identity, preview framework or mock-auth code in the source tree', () => {
  const files = ['src', 'scripts', 'public']
    .flatMap((dir) => readdirSync(path.join(projectRoot, dir), { recursive: true, encoding: 'utf8' }).map((f) => path.join(dir, f)))
    .filter((f) => /\.(ts|tsx|mjs|js|html)$/.test(f));
  assert.ok(files.length > 5);
  for (const f of files) {
    const text = read(f);
    assert.ok(!/openai|chatgpt|x-openai|vinext|next\/|localStorage\.setItem\(['"](token|session)/i.test(text), f);
  }
});

test('lockfile pins exact versions and package.json uses exact specifiers', () => {
  const pkg = JSON.parse(read('package.json')) as Record<string, Record<string, string>>;
  for (const deps of [pkg.dependencies, pkg.devDependencies]) {
    for (const [name, spec] of Object.entries(deps ?? {})) assert.match(spec, /^\d+\.\d+\.\d+$/, `${name}@${spec}`);
  }
  const lock = JSON.parse(read('package-lock.json')) as { lockfileVersion: number; packages: Record<string, { version?: string; integrity?: string }> };
  assert.equal(lock.lockfileVersion, 3);
  for (const [p, meta] of Object.entries(lock.packages)) {
    if (p === '') continue;
    assert.ok(meta.version && meta.integrity, `${p} lacks version/integrity`);
  }
});
