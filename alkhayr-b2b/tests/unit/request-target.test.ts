import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError } from '../../src/server/http/errors.ts';
import { parseRequestTarget } from '../../src/server/http/request-target.ts';

const code = (raw: string | undefined) => {
  try {
    parseRequestTarget(raw);
    return 'OK';
  } catch (err) {
    assert.ok(err instanceof AppError);
    return err.code;
  }
};

test('accepts ordinary origin-form targets without normalizing them', () => {
  const t = parseRequestTarget('/api/v1/products?q=%D8%B4%D9%8A%D9%83%D9%88&limit=20#frag');
  assert.equal(t.pathname, '/api/v1/products');
  assert.equal(t.query.get('q'), 'شيكو');
  assert.equal(t.query.get('limit'), '20');
  assert.equal(parseRequestTarget('/').pathname, '/');
  assert.equal(parseRequestTarget('/assets/').pathname, '/assets/');
});

test('rejects traversal, encoded separators, NUL, backslashes and non-origin forms', () => {
  for (const raw of [
    undefined, '', '*', 'http://x/', 'x', '//etc/passwd', '/../a', '/a/../b', '/a/./b', '/a/..', '/%2e%2e/a', '/%2E/a',
    '/a%2fb', '/a%5cb', '/a%00', '/a\\b', '/a//b', '/a b', '/é',
  ]) {
    assert.equal(code(raw), raw === undefined || raw === '' ? 'BAD_REQUEST' : 'BAD_REQUEST', String(raw));
  }
});

test('rejects targets longer than the URL limit with 414', () => {
  assert.equal(code('/' + 'a'.repeat(2048)), 'URI_TOO_LONG');
  assert.equal(code('/' + 'a'.repeat(2046)), 'OK');
});
