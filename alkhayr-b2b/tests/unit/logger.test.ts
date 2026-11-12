import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger, redact } from '../../src/server/logger.ts';

test('sensitive keys are redacted; booleans and ordinary fields are kept', () => {
  const out = redact({ password: 'p', sessionToken: 't', csrf: 'c', cookie: 'k', appSecretConfigured: true, path: '/x', status: 200 });
  assert.deepEqual(out, { password: '[REDACTED]', sessionToken: '[REDACTED]', csrf: '[REDACTED]', cookie: '[REDACTED]', appSecretConfigured: true, path: '/x', status: 200 });
});

test('emits JSON lines and respects the level', () => {
  const lines: string[] = [];
  const sink = { write: (l: string) => void lines.push(l) };
  const log = createLogger('warn', sink, sink);
  log.info('ignored');
  log.warn('kept', { password: 'hunter2' });
  assert.equal(lines.length, 1);
  const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(parsed.event, 'kept');
  assert.equal(parsed.password, '[REDACTED]');
});
