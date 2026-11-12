import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { describe, test } from 'node:test';
import { ConfigError, describeConfig, loadConfig } from '../../src/server/config.ts';

const base = { baseDir: '/srv/alkhayr', staticRoot: '/srv/alkhayr/dist/web' };
const secret = () => randomBytes(32).toString('base64url');

function issuesOf(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof ConfigError, 'expected ConfigError');
    return [...err.issues];
  }
  assert.fail('expected configuration to be rejected');
}

describe('loadConfig', () => {
  test('development defaults are valid and need no secrets', () => {
    const c = loadConfig({}, base);
    assert.equal(c.nodeEnv, 'development');
    assert.equal(c.host, '127.0.0.1');
    assert.equal(c.port, 3000);
    assert.equal(c.appOrigin, 'http://localhost:3000');
    assert.equal(c.expectedHost, 'localhost:3000');
    assert.equal(c.appSecret, null);
    assert.equal(c.dataDir, path.resolve('/srv/alkhayr/data'));
    assert.equal(c.http.headersTimeoutMs, 15000);
    assert.equal(c.http.requestTimeoutMs, 30000);
    assert.ok(Object.isFrozen(c));
  });

  test('empty strings count as unset (copied .env.example works in development)', () => {
    const c = loadConfig({ APP_SECRET: '', BACKUP_KEY: '', TRUST_PROXY: '', PORT: '' }, base);
    assert.equal(c.appSecret, null);
    assert.equal(c.port, 3000);
  });

  test('production requires https origin and both secrets', () => {
    const issues = issuesOf(() => loadConfig({ NODE_ENV: 'production', APP_ORIGIN: 'http://shop.example.com' }, base));
    assert.ok(issues.includes('APP_ORIGIN must use https in production'));
    assert.ok(issues.includes('APP_SECRET is required in production'));
    assert.ok(issues.includes('BACKUP_KEY is required in production'));
  });

  test('production requires APP_ORIGIN explicitly', () => {
    const issues = issuesOf(() => loadConfig({ NODE_ENV: 'production', APP_SECRET: secret(), BACKUP_KEY: secret() }, base));
    assert.ok(issues.includes('APP_ORIGIN is required in production'));
  });

  test('valid production config', () => {
    const c = loadConfig({ NODE_ENV: 'production', APP_ORIGIN: 'https://b2b.example.com', APP_SECRET: secret(), BACKUP_KEY: secret(), TRUST_PROXY: '127.0.0.1, ::1' }, base);
    assert.equal(c.isProduction, true);
    assert.equal(c.expectedHost, 'b2b.example.com');
    assert.equal(c.appSecret?.length, 32);
    assert.deepEqual(c.trustProxy, ['127.0.0.1', '::1']);
  });

  test('origin must be a bare canonical origin', () => {
    for (const bad of ['https://b2b.example.com/app', 'https://u:p@b2b.example.com', 'https://b2b.example.com?x=1', 'ftp://b2b.example.com', 'not a url', 'https://B2B.example.com', 'https://b2b.example.com:443']) {
      assert.ok(issuesOf(() => loadConfig({ APP_ORIGIN: bad }, base)).length > 0, bad);
    }
    assert.equal(loadConfig({ APP_ORIGIN: 'http://localhost:8080' }, base).expectedHost, 'localhost:8080');
  });

  test('secrets: placeholder, short, non-base64url, low-entropy and identical values are rejected', () => {
    const s = secret();
    const cases: Array<[Record<string, string>, RegExp]> = [
      [{ APP_SECRET: 'CHANGE_ME' }, /placeholder/],
      [{ APP_SECRET: 'replace-me-with-a-real-secret-value-please-now' }, /placeholder/],
      [{ APP_SECRET: randomBytes(16).toString('base64url') }, /at least 32 bytes/],
      [{ APP_SECRET: randomBytes(32).toString('base64') + '+/=' }, /base64url/],
      [{ APP_SECRET: Buffer.alloc(32, 7).toString('base64url') }, /entropy/],
      [{ APP_SECRET: s, BACKUP_KEY: s }, /independent/],
    ];
    for (const [env, pattern] of cases) {
      const issues = issuesOf(() => loadConfig(env, base));
      assert.ok(issues.some((i) => pattern.test(i)), `${JSON.stringify(Object.keys(env))} -> ${issues.join('; ')}`);
    }
  });

  test('validation messages never echo secret values', () => {
    const value = randomBytes(8).toString('base64url');
    const issues = issuesOf(() => loadConfig({ APP_SECRET: value, NODE_ENV: 'bogus' }, base));
    assert.ok(!issues.join('\n').includes(value));
  });

  test('ports, timeouts, proxies and log level are validated', () => {
    assert.ok(issuesOf(() => loadConfig({ PORT: '70000' }, base)).length > 0);
    assert.ok(issuesOf(() => loadConfig({ PORT: '-1' }, base)).length > 0);
    assert.ok(issuesOf(() => loadConfig({ PORT: '3e3' }, base)).length > 0);
    assert.ok(issuesOf(() => loadConfig({ HTTP_HEADERS_TIMEOUT_MS: '10' }, base)).length > 0);
    assert.ok(issuesOf(() => loadConfig({ HTTP_HEADERS_TIMEOUT_MS: '20000', HTTP_REQUEST_TIMEOUT_MS: '10000' }, base)).length > 0);
    assert.ok(issuesOf(() => loadConfig({ TRUST_PROXY: '10.0.0.0/8' }, base)).length > 0);
    assert.ok(issuesOf(() => loadConfig({ TRUST_PROXY: 'proxy.local' }, base)).length > 0);
    assert.ok(issuesOf(() => loadConfig({ LOG_LEVEL: 'trace' }, base)).length > 0);
  });

  test('data and backup directories may not overlap the static web root', () => {
    assert.ok(issuesOf(() => loadConfig({ DATA_DIR: './dist/web/data' }, base)).some((i) => i.startsWith('DATA_DIR')));
    assert.ok(issuesOf(() => loadConfig({ BACKUP_DIR: './dist' }, base)).some((i) => i.startsWith('BACKUP_DIR')));
  });

  test('describeConfig contains no secret material', () => {
    const s = secret();
    const c = loadConfig({ APP_SECRET: s, BACKUP_KEY: secret() }, base);
    const text = JSON.stringify(describeConfig(c));
    assert.ok(!text.includes(s));
    assert.match(text, /"appSecretConfigured":true/);
  });
});
