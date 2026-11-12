import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { AppError } from '../../src/server/http/errors.ts';
import { readJsonBody } from '../../src/server/http/request-body.ts';

function source(headers: Record<string, string>, chunks: Array<string | Buffer>) {
  const stream = new PassThrough() as PassThrough & { headers: Record<string, string> };
  stream.headers = headers;
  setImmediate(() => {
    for (const c of chunks) stream.write(c);
    stream.end();
  });
  return stream;
}

async function rejectsWith(p: Promise<unknown>, code: string) {
  await assert.rejects(p, (err: unknown) => err instanceof AppError && err.code === code);
}

test('parses UTF-8 JSON including Arabic text', async () => {
  const body = await readJsonBody(source({ 'content-type': 'application/json; charset=utf-8' }, ['{"note":"', 'شحن سريع"}']));
  assert.deepEqual(body, { note: 'شحن سريع' });
});

test('requires application/json', async () => {
  await rejectsWith(readJsonBody(source({ 'content-type': 'text/plain' }, ['{}'])), 'UNSUPPORTED_MEDIA_TYPE');
  await rejectsWith(readJsonBody(source({}, ['{}'])), 'UNSUPPORTED_MEDIA_TYPE');
  await rejectsWith(readJsonBody(source({ 'content-type': 'application/json; charset=latin1' }, ['{}'])), 'UNSUPPORTED_MEDIA_TYPE');
});

test('enforces the limit while streaming even when Content-Length is absent', async () => {
  const chunk = Buffer.alloc(1024, 0x20);
  const err = await readJsonBody(source({ 'content-type': 'application/json' }, Array(10).fill(chunk)), 4096).catch((e: unknown) => e);
  assert.ok(err instanceof AppError);
  assert.equal(err.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(err.headers?.Connection, 'close');
});

test('rejects an oversized declared Content-Length before reading', async () => {
  await rejectsWith(readJsonBody(source({ 'content-type': 'application/json', 'content-length': '999999' }, ['{}']), 1024), 'PAYLOAD_TOO_LARGE');
  await rejectsWith(readJsonBody(source({ 'content-type': 'application/json', 'content-length': '12abc' }, ['{}']), 1024), 'BAD_REQUEST');
});

test('rejects invalid JSON, empty bodies and invalid UTF-8', async () => {
  await rejectsWith(readJsonBody(source({ 'content-type': 'application/json' }, ['{bad'])), 'INVALID_JSON');
  await rejectsWith(readJsonBody(source({ 'content-type': 'application/json' }, ['   '])), 'INVALID_JSON');
  await rejectsWith(readJsonBody(source({ 'content-type': 'application/json' }, [Buffer.from([0x22, 0xff, 0xfe, 0x22])])), 'INVALID_JSON');
});
