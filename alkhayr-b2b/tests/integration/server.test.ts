import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import {
  baseEnv,
  CANARY,
  createTempApp,
  rawRequest,
  runUntilExit,
  startServer,
  TEST_HOST,
  type RunningServer,
  type TempApp,
} from '../helpers/server.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ARABIC = /[؀-ۿ]/;

function assertErrorEnvelope(res: { status: number; headers: Record<string, unknown>; body: string }, status: number, code: string) {
  assert.equal(res.status, status);
  assert.match(String(res.headers['content-type']), /^application\/json/);
  const body = JSON.parse(res.body) as { error: { code: string; message: string; requestId: string } };
  assert.equal(body.error.code, code);
  assert.match(body.error.message, ARABIC, 'error message must be Arabic');
  assert.match(body.error.requestId, UUID);
  assert.equal(body.error.requestId, res.headers['x-request-id'], 'body requestId must equal X-Request-Id header');
  assert.ok(!res.body.includes('<html'), 'error must never be the SPA page');
}

let app: TempApp;
// Separate app root (own data directory) for tests that start additional servers:
// only one server may use a data directory at a time (single-instance lock).
let isolatedApp: TempApp;
let server: RunningServer;
let manifest: { files: Record<string, { file: string; type: string }> };

before(async () => {
  app = await createTempApp();
  manifest = JSON.parse(await readFile(path.join(app.distDir, 'web', '.static-manifest.json'), 'utf8'));
  server = await startServer(app);
  isolatedApp = await createTempApp();
});

after(async () => {
  await server?.stop();
  await app?.cleanup();
  await isolatedApp?.cleanup();
});

describe('real page and static assets', () => {
  test('GET / serves the built Arabic RTL page with security headers', async () => {
    const res = await rawRequest(server.port, { path: '/' });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/html; charset=utf-8');
    assert.match(res.body, /<html lang="ar" dir="rtl">/);
    assert.match(res.body, /<script type="module" src="\/assets\/main-[A-Z0-9]+\.js"><\/script>/);
    assert.match(String(res.headers['content-security-policy']), /script-src 'self'/);
    assert.ok(!String(res.headers['content-security-policy']).includes('unsafe'), 'CSP must not allow unsafe-*');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.equal(res.headers['cache-control'], 'no-cache');
    assert.match(String(res.headers['x-request-id']), UUID);
    assert.equal(res.headers['access-control-allow-origin'], undefined, 'no CORS');
  });

  test('every manifest asset is served with its declared type; HEAD has no body; ETag revalidates', async () => {
    const keys = Object.keys(manifest.files).filter((k) => k !== '/');
    assert.ok(keys.length >= 3);
    for (const key of keys) {
      const res = await rawRequest(server.port, { path: key });
      assert.equal(res.status, 200, key);
      assert.equal(res.headers['content-type'], manifest.files[key]!.type);
      assert.equal(res.headers['cache-control'], 'public, max-age=31536000, immutable');
      const head = await rawRequest(server.port, { method: 'HEAD', path: key });
      assert.equal(head.status, 200);
      assert.equal(head.body, '');
      assert.ok(Number(head.headers['content-length']) > 0);
      const cached = await rawRequest(server.port, { path: key, headers: { 'If-None-Match': String(res.headers.etag) } });
      assert.equal(cached.status, 304);
    }
  });

  test('POST to a static page is 405 with Allow', async () => {
    const res = await rawRequest(server.port, { method: 'POST', path: '/' });
    assertErrorEnvelope(res, 405, 'METHOD_NOT_ALLOWED');
    assert.equal(res.headers.allow, 'GET, HEAD');
  });

  test('browser bundle contains no server secret, env access or source path', async () => {
    for (const entry of Object.values(manifest.files)) {
      const content = await readFile(path.join(app.distDir, 'web', entry.file));
      const text = content.toString('latin1');
      assert.ok(!text.includes(CANARY));
      if (entry.file.endsWith('.js')) {
        assert.ok(!text.includes('process.env'), `${entry.file} references process.env`);
        assert.ok(!/APP_SECRET|BACKUP_KEY/.test(text), `${entry.file} mentions secret variable names`);
      }
    }
  });
});

describe('process output', () => {
  test('the bundled server starts without Node warnings (module type is declared next to the bundle)', () => {
    assert.ok(!/Warning:/.test(server.stderr()), server.stderr());
  });
});

describe('health endpoint', () => {
  test('GET /healthz returns exactly {status:"ok"} and no-store', async () => {
    const res = await rawRequest(server.port, { path: '/healthz' });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { status: 'ok' });
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.match(String(res.headers['content-type']), /^application\/json; charset=utf-8$/);
  });

  test('HEAD /healthz works; POST /healthz is 405', async () => {
    const head = await rawRequest(server.port, { method: 'HEAD', path: '/healthz' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    const post = await rawRequest(server.port, { method: 'POST', path: '/healthz' });
    assertErrorEnvelope(post, 405, 'METHOD_NOT_ALLOWED');
    assert.equal(post.headers.allow, 'GET, HEAD');
  });

  test('query strings do not change the health response', async () => {
    const res = await rawRequest(server.port, { path: '/healthz?verbose=1&debug=true' });
    assert.deepEqual(JSON.parse(res.body), { status: 'ok' });
  });
});

describe('unknown endpoints', () => {
  for (const [method, p] of [
    ['GET', '/api/v1/does-not-exist'],
    ['GET', '/api/v1'],
    ['GET', '/api'],
    ['POST', '/api/v1/orders'],
    ['DELETE', '/api/v1/admin/inventory/1'],
    ['GET', '/api/v1/admin/backup'],
    ['POST', '/api/v1/admin/restore'],
  ] as const) {
    test(`${method} ${p} -> JSON 404, never index.html`, async () => {
      // Mutations must come from the configured origin even to learn that a path does not exist.
      const headers: Record<string, string> = method === 'GET' ? {} : { Origin: `http://${TEST_HOST}` };
      assertErrorEnvelope(await rawRequest(server.port, { method, path: p, headers }), 404, 'NOT_FOUND');
    });
  }

  test('products have no DELETE: known paths answer 405 with Allow, never delete', async () => {
    for (const p of ['/api/v1/products/2b0c2a8e-6e1e-4b55-9d0f-1f2a3b4c5d6e', '/api/v1/admin/products/2b0c2a8e-6e1e-4b55-9d0f-1f2a3b4c5d6e']) {
      const res = await rawRequest(server.port, { method: 'DELETE', path: p, headers: { Origin: `http://${TEST_HOST}` } });
      assertErrorEnvelope(res, 405, 'METHOD_NOT_ALLOWED');
      assert.ok(!String(res.headers.allow).includes('DELETE'));
    }
  });

  test('an API mutation without the configured Origin is refused before routing', async () => {
    assertErrorEnvelope(await rawRequest(server.port, { method: 'DELETE', path: '/api/v1/products/1' }), 403, 'ORIGIN_REJECTED');
    assertErrorEnvelope(await rawRequest(server.port, { method: 'POST', path: '/api/v1/orders', headers: { Origin: 'https://evil.example' } }), 403, 'ORIGIN_REJECTED');
  });

  for (const p of ['/catalog', '/index.html', '/admin', '/favicon.ico', '/assets/', '/assets/missing.js']) {
    test(`GET ${p} -> 404 (no SPA fallback)`, async () => {
      assertErrorEnvelope(await rawRequest(server.port, { path: p }), 404, 'NOT_FOUND');
    });
  }
});

describe('filesystem exposure attempts are rejected', () => {
  const attempts = [
    '/.env',
    '/.env.example',
    '/../.env',
    '/assets/../../.env',
    '/assets/../index.html',
    '/%2e%2e/.env',
    '/%2E%2E%2F.env',
    '/assets/%2e%2e/%2e%2e/package.json',
    '/assets%2f..%2f..%2f.env',
    '/assets/..%5c..%5c.env',
    '/assets\\..\\..\\.env',
    '/%00',
    '/.env%00.png',
    '//etc/passwd',
    '/./.env',
    '/package.json',
    '/src/server/main.ts',
    '/server/main.js',
    '/dist/server/main.js',
    '/dist/server/main.js.map',
    '/data/alkhayr.db',
    '/data/alkhayr.db-wal',
    '/data/alkhayr.db-shm',
    '/data/alkhayr.instance.lock',
    '/alkhayr.db',
    '/alkhayr.db-wal',
    '/alkhayr.db-shm',
    '/assets/alkhayr.db',
    '/backups/alkhayr.enc',
    '/data/',
    '/migrations/',
    '/.static-manifest.json',
    '/assets/.static-manifest.json',
    '/secret.txt',
    '/assets/secret.txt',
    '/.git/config',
    '/node_modules/react/package.json',
    '/migrations/0001_initial.sql',
  ];
  for (const attempt of attempts) {
    test(`GET ${attempt}`, async () => {
      const res = await rawRequest(server.port, { path: attempt });
      assert.ok(res.status === 400 || res.status === 404, `unexpected status ${res.status}`);
      assert.match(String(res.headers['content-type']), /^application\/json/);
      assert.ok(!res.body.includes(CANARY), 'canary content leaked');
      assert.ok(!res.body.includes('<html'), 'SPA page returned for a file path');
    });
  }

  test('absolute-form request target is rejected', async () => {
    const res = await rawRequest(server.port, { path: `http://${TEST_HOST}/.env` });
    assertErrorEnvelope(res, 400, 'BAD_REQUEST');
  });

  test('over-long URL is rejected with 414', async () => {
    const res = await rawRequest(server.port, { path: '/api/v1/' + 'a'.repeat(3000) });
    assertErrorEnvelope(res, 414, 'URI_TOO_LONG');
  });
});

describe('host validation', () => {
  test('a foreign Host header is rejected', async () => {
    const res = await rawRequest(server.port, { path: '/healthz', headers: { Host: 'evil.example' } });
    assertErrorEnvelope(res, 400, 'HOST_REJECTED');
  });

  test('host check is case-insensitive for the configured host', async () => {
    const res = await rawRequest(server.port, { path: '/healthz', headers: { Host: TEST_HOST.toUpperCase() } });
    assert.equal(res.status, 200);
  });

  test('HTTP/1.1 request without Host is refused', async () => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect(server.port, '127.0.0.1', () => socket.write('GET /healthz HTTP/1.1\r\nConnection: close\r\n\r\n'));
      let data = '';
      socket.setEncoding('utf8').on('data', (d: string) => (data += d));
      socket.on('end', () => resolve(data));
      socket.on('error', reject);
    });
    assert.match(response, /^HTTP\/1\.1 400/);
  });
});

describe('logging hygiene', () => {
  test('cookies, authorization headers and query strings do not reach logs', async () => {
    const marker = `LOGCANARY${randomBytes(8).toString('hex')}`;
    await rawRequest(server.port, {
      path: `/api/v1/nope?token=${marker}`,
      headers: { Cookie: `__Host-alkhayr_session=${marker}`, Authorization: `Bearer ${marker}`, 'X-User-Role': 'admin' },
    });
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(server.stdout().includes('"path":"/api/v1/nope"'));
    assert.ok(!server.stdout().includes(marker) && !server.stderr().includes(marker));
  });
});

describe('timeouts and shutdown', () => {
  test('incomplete request headers are dropped after HTTP_HEADERS_TIMEOUT_MS', async () => {
    const slow = await startServer(isolatedApp, baseEnv({ HTTP_HEADERS_TIMEOUT_MS: '1000', HTTP_REQUEST_TIMEOUT_MS: '2000' }));
    try {
      const started = Date.now();
      const result = await new Promise<{ data: string; ms: number }>((resolve, reject) => {
        const socket = connect(slow.port, '127.0.0.1', () => socket.write(`GET /healthz HTTP/1.1\r\nHost: ${TEST_HOST}\r\n`));
        let data = '';
        socket.setEncoding('utf8').on('data', (d: string) => (data += d));
        socket.on('close', () => resolve({ data, ms: Date.now() - started }));
        socket.on('error', reject);
        setTimeout(() => reject(new Error('socket was not closed by the server')), 6000).unref();
      });
      assert.ok(result.ms >= 900 && result.ms < 4500, `closed after ${result.ms} ms`);
      assert.match(result.data, /^HTTP\/1\.1 408/);
    } finally {
      await slow.stop();
    }
  });

  test('SIGTERM shuts down gracefully with exit code 0', async () => {
    const s = await startServer(isolatedApp);
    const ok = await rawRequest(s.port, { path: '/healthz' });
    assert.equal(ok.status, 200);
    const code = await s.stop('SIGTERM');
    assert.equal(code, 0);
    assert.match(s.stdout(), /"event":"shutdown_started","signal":"SIGTERM"/);
    assert.match(s.stdout(), /"event":"shutdown_complete"/);
  });

  test('SIGTERM waits for an in-flight keep-alive connection to finish', async () => {
    const s = await startServer(isolatedApp, baseEnv({ SHUTDOWN_GRACE_MS: '3000' }));
    const res = await rawRequest(s.port, { path: '/', headers: { Connection: 'keep-alive' } });
    assert.equal(res.status, 200);
    assert.equal(await s.stop('SIGTERM'), 0);
  });
});

describe('APP_SECRET is required to run the server in every mode (stage 04)', () => {
  test('development/test without APP_SECRET -> exit 1 APP_SECRET_REQUIRED, no fallback key', async () => {
    const r = await runUntilExit(app, baseEnv({ APP_SECRET: '', BACKUP_KEY: '' }));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /"code":"APP_SECRET_REQUIRED"/);
  });
});

describe('production configuration fails closed', () => {
  const secret = () => randomBytes(32).toString('base64url');

  test('http origin in production -> exit 1 without echoing values', async () => {
    const appSecret = secret();
    const r = await runUntilExit(app, baseEnv({ NODE_ENV: 'production', APP_ORIGIN: 'http://portal.example.test', APP_SECRET: appSecret, BACKUP_KEY: secret() }));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /APP_ORIGIN must use https in production/);
    assert.ok(!r.stderr.includes(appSecret) && !r.stdout.includes(appSecret));
  });

  test('missing secrets in production -> exit 1', async () => {
    const r = await runUntilExit(app, baseEnv({ NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example.test', APP_SECRET: '', BACKUP_KEY: '' }));
    assert.equal(r.code, 1);
    assert.match(r.stderr, /APP_SECRET is required in production/);
    assert.match(r.stderr, /BACKUP_KEY is required in production/);
  });

  test('placeholder or identical secrets -> exit 1', async () => {
    const same = secret();
    const r1 = await runUntilExit(app, baseEnv({ NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example.test', APP_SECRET: 'CHANGE_ME', BACKUP_KEY: secret() }));
    assert.equal(r1.code, 1);
    assert.match(r1.stderr, /placeholder/);
    const r2 = await runUntilExit(app, baseEnv({ NODE_ENV: 'production', APP_ORIGIN: 'https://portal.example.test', APP_SECRET: same, BACKUP_KEY: same }));
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /independent/);
  });

  test('valid production config starts, sends HSTS, and logs no secret', async () => {
    const appSecret = secret();
    const backupKey = secret();
    const s = await startServer(isolatedApp, baseEnv({ NODE_ENV: 'production', APP_ORIGIN: `https://${TEST_HOST}`, APP_SECRET: appSecret, BACKUP_KEY: backupKey }));
    try {
      const res = await rawRequest(s.port, { path: '/healthz' });
      assert.equal(res.status, 200);
      assert.match(String(res.headers['strict-transport-security']), /max-age=31536000/);
      const page = await rawRequest(s.port, { path: '/' });
      assert.equal(page.status, 200);
      assert.ok(!s.stdout().includes(appSecret) && !s.stdout().includes(backupKey));
      assert.ok(!s.stderr().includes(appSecret) && !s.stderr().includes(backupKey));
    } finally {
      await s.stop();
    }
  });

  test('tampered web asset (checksum mismatch) prevents startup', async () => {
    const other = await createTempApp();
    try {
      const m = JSON.parse(await readFile(path.join(other.distDir, 'web', '.static-manifest.json'), 'utf8')) as { files: Record<string, { file: string }> };
      const js = Object.values(m.files).find((f) => f.file.endsWith('.js'))!;
      const { appendFile } = await import('node:fs/promises');
      await appendFile(path.join(other.distDir, 'web', js.file), '\n/* tampered */');
      const r = await runUntilExit(other, baseEnv());
      assert.notEqual(r.code, 0);
      assert.match(r.stderr + r.stdout, /checksum/);
    } finally {
      await other.cleanup();
    }
  });
});
