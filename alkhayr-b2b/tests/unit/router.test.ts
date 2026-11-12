import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Router } from '../../src/server/http/router.ts';

const noop = () => {};

test('matches exact paths and parameters; HEAD follows GET', () => {
  const r = new Router().get('/healthz', noop).add('POST', '/api/v1/orders', noop).get('/api/v1/orders/:id', noop);
  assert.equal(r.match('GET', '/healthz').kind, 'matched');
  assert.equal(r.match('HEAD', '/healthz').kind, 'matched');
  const m = r.match('GET', '/api/v1/orders/2b0c2a8e-6e1e-4b55-9d0f-1f2a3b4c5d6e');
  assert.equal(m.kind, 'matched');
  assert.deepEqual(m.kind === 'matched' ? m.params : null, { id: '2b0c2a8e-6e1e-4b55-9d0f-1f2a3b4c5d6e' });
});

test('reports 405 with the allowed methods, and 404 otherwise', () => {
  const r = new Router().get('/healthz', noop).add('POST', '/api/v1/orders', noop);
  assert.deepEqual(r.match('POST', '/healthz'), { kind: 'method_not_allowed', allow: ['GET', 'HEAD'] });
  assert.deepEqual(r.match('GET', '/api/v1/orders'), { kind: 'method_not_allowed', allow: ['POST'] });
  assert.equal(r.match('GET', '/healthz/').kind, 'not_found');
  assert.equal(r.match('GET', '/HEALTHZ').kind, 'not_found');
  assert.equal(r.match('GET', '/api/v1/orders/extra').kind, 'not_found');
});

test('parameters only accept unreserved characters', () => {
  const r = new Router().get('/api/v1/products/:id', noop);
  for (const bad of ['%27%20OR%201%3D1', 'a;b', "a'b", '']) {
    assert.equal(r.match('GET', `/api/v1/products/${bad}`).kind, 'not_found', bad);
  }
});
