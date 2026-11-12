import type { IncomingHttpHeaders } from 'node:http';
import { AppError } from './errors.ts';
import { LIMITS } from '../../shared/constants.ts';

export interface BodySource extends NodeJS.EventEmitter {
  readonly headers: IncomingHttpHeaders;
  pause(): unknown;
}

const JSON_CONTENT_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;

/**
 * Read and parse a JSON request body with the byte limit enforced WHILE
 * streaming (a lying or absent Content-Length cannot bypass it). On overflow
 * the stream is paused and a 413 carrying "Connection: close" is thrown so
 * the server drops the socket instead of reading the remainder.
 */
export function readJsonBody(req: BodySource, limitBytes: number = LIMITS.jsonBodyDefaultBytes): Promise<unknown> {
  const contentType = req.headers['content-type'];
  if (typeof contentType !== 'string' || !JSON_CONTENT_TYPE.test(contentType.trim())) {
    return Promise.reject(new AppError('UNSUPPORTED_MEDIA_TYPE'));
  }
  const tooLarge = () => new AppError('PAYLOAD_TOO_LARGE', { headers: { Connection: 'close' } });
  const declared = req.headers['content-length'];
  if (declared !== undefined && (!/^\d+$/.test(declared) || Number(declared) > limitBytes)) {
    req.pause();
    return Promise.reject(/^\d+$/.test(declared) ? tooLarge() : new AppError('BAD_REQUEST', { headers: { Connection: 'close' } }));
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const cleanup = () => {
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      req.removeListener('aborted', onAborted);
    };
    const fail = (err: AppError) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.pause();
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > limitBytes) return fail(tooLarge());
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      const raw = Buffer.concat(chunks, total);
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw);
      } catch {
        return reject(new AppError('INVALID_JSON'));
      }
      if (text.trim() === '') return reject(new AppError('INVALID_JSON'));
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new AppError('INVALID_JSON'));
      }
    };
    const onError = () => fail(new AppError('BAD_REQUEST', { headers: { Connection: 'close' } }));
    const onAborted = () => fail(new AppError('BAD_REQUEST', { headers: { Connection: 'close' } }));
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);
  });
}
