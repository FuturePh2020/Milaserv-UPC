import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream, statSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Minimal S3 REST client for the off-server backup copy (stage 17). It uses the provider's documented
 * REST API (PUT/HEAD/GET Object, Signature Version 4) through Node's own `fetch`; no SDK dependency.
 * Works with AWS S3 and S3-compatible services (path-style or virtual-hosted URLs).
 *
 * - Every request is signed with the SHA-256 of its payload (no UNSIGNED-PAYLOAD), so the service rejects
 *   a body that was changed in transit; the upload also sends `x-amz-checksum-sha256`.
 * - Credentials are passed in by the caller (read from protected files); they are never logged.
 * - Errors carry the HTTP status and the S3 error code only (never the response body or headers).
 */

export interface S3Config {
  /** https://s3.eu-central-1.amazonaws.com, https://<account>.r2.cloudflarestorage.com, … */
  endpoint: string;
  region: string;
  bucket: string;
  /** Object key prefix, e.g. "alkhayr/prod/" (no leading slash). */
  prefix: string;
  pathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  /** Test hook: request timeout (ms). */
  timeoutMs?: number;
}

export class S3Error extends Error {
  readonly status: number;
  readonly s3Code: string | null;
  constructor(message: string, status: number, s3Code: string | null) {
    super(message);
    this.name = 'S3Error';
    this.status = status;
    this.s3Code = s3Code;
  }
}

const sha256hex = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, d: string) => createHmac('sha256', k).update(d).digest();

/** RFC 3986 encoding as required by SigV4 (unreserved characters kept; '/' kept in paths). */
function encodePath(p: string): string {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

export async function fileSha256(file: string): Promise<{ hex: string; base64: string; bytes: number }> {
  const h = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    h.update(chunk as Buffer);
    bytes += (chunk as Buffer).length;
  }
  const d = h.digest();
  return { hex: d.toString('hex'), base64: d.toString('base64'), bytes };
}

export class S3Client {
  readonly #c: S3Config;
  constructor(config: S3Config) {
    const u = new URL(config.endpoint);
    if (u.pathname !== '/' || u.search || u.username || u.password) throw new Error('S3 endpoint must be a bare origin');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(config.bucket)) throw new Error('invalid bucket name');
    if (config.prefix.startsWith('/') || config.prefix.includes('..')) throw new Error('invalid object prefix');
    this.#c = config;
  }

  key(name: string): string {
    return `${this.#c.prefix}${name}`;
  }

  #url(key: string): URL {
    const e = new URL(this.#c.endpoint);
    if (this.#c.pathStyle) return new URL(`${e.origin}/${this.#c.bucket}/${encodePath(key)}`);
    return new URL(`${e.protocol}//${this.#c.bucket}.${e.host}/${encodePath(key)}`);
  }

  #sign(method: string, url: URL, payloadHash: string, extra: Record<string, string>, now: Date): Record<string, string> {
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const date = amzDate.slice(0, 8);
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...lower(extra) };
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
    const signedHeaders = names.join(';');
    const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const scope = `${date}/${this.#c.region}/s3/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
    const kDate = hmac(`AWS4${this.#c.secretAccessKey}`, date);
    const kSigning = hmac(hmac(hmac(kDate, this.#c.region), 's3'), 'aws4_request');
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const out = { ...headers, authorization: `AWS4-HMAC-SHA256 Credential=${this.#c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
    delete (out as Record<string, string>).host; // fetch sets Host from the URL (same value as signed)
    return out;
  }

  async #fetch(method: string, url: URL, init: { headers: Record<string, string>; body?: ReadableStream | null }): Promise<Response> {
    try {
      return await fetch(url, {
        method,
        headers: init.headers,
        ...(init.body ? { body: init.body, duplex: 'half' } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(this.#c.timeoutMs ?? 15 * 60_000),
      } as RequestInit);
    } catch (err) {
      throw new S3Error(`network error contacting the off-server destination (${(err as Error).name})`, 0, null);
    }
  }

  static async #fail(r: Response, what: string): Promise<never> {
    let code: string | null = null;
    try {
      code = /<Code>([A-Za-z0-9.]{1,64})<\/Code>/.exec(await r.text())?.[1] ?? null;
    } catch {
      /* ignore */
    }
    throw new S3Error(`${what} failed with HTTP ${r.status}${code ? ` (${code})` : ''}`, r.status, code);
  }

  /** Uploads a file; the payload hash is signed and the SHA-256 checksum is sent for server-side checking. */
  async putFile(key: string, file: string, sha: { hex: string; base64: string; bytes: number }, now = new Date()): Promise<void> {
    const url = this.#url(key);
    const headers = this.#sign('PUT', url, sha.hex, { 'content-length': String(sha.bytes), 'x-amz-checksum-sha256': sha.base64, 'content-type': 'application/octet-stream' }, now);
    const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
    const r = await this.#fetch('PUT', url, { headers, body });
    if (!r.ok) await S3Client.#fail(r, 'upload');
    await r.body?.cancel();
  }

  /** Object metadata: size and (when the service stores it) the SHA-256 checksum. */
  async head(key: string, now = new Date()): Promise<{ bytes: number; sha256Base64: string | null }> {
    const url = this.#url(key);
    const headers = this.#sign('HEAD', url, sha256hex(''), { 'x-amz-checksum-mode': 'ENABLED' }, now);
    const r = await this.#fetch('HEAD', url, { headers });
    if (!r.ok) await S3Client.#fail(r, 'metadata check');
    return { bytes: Number(r.headers.get('content-length')), sha256Base64: r.headers.get('x-amz-checksum-sha256') };
  }

  /** Downloads into `target` (created exclusively, 0600) and returns the SHA-256 of what was received. */
  async getToFile(key: string, target: string, now = new Date()): Promise<{ hex: string; bytes: number }> {
    const url = this.#url(key);
    const headers = this.#sign('GET', url, sha256hex(''), {}, now);
    const r = await this.#fetch('GET', url, { headers });
    if (!r.ok || !r.body) await S3Client.#fail(r, 'download');
    const h = createHash('sha256');
    let bytes = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _e, cb) {
        h.update(chunk);
        bytes += chunk.length;
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(r.body as never), tap, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
    if (bytes !== statSync(target).size) throw new S3Error('download size mismatch', 0, null);
    return { hex: h.digest('hex'), bytes };
  }
}

function lower(h: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
}
