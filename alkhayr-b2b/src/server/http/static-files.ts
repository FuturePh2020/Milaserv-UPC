import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';
import type { Logger } from '../logger.ts';

/**
 * Static assets are served ONLY from an explicit allow-list written by the
 * build (dist/web/.static-manifest.json). Request paths are looked up as exact
 * keys; they are never joined onto the filesystem, so traversal cannot reach
 * anything outside the manifest. There is no index.html fallback.
 */

export const MANIFEST_FILENAME = '.static-manifest.json';

export const ALLOWED_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

const URL_KEY = /^\/(assets\/[A-Za-z0-9][A-Za-z0-9._-]{0,200})?$/;

export interface ManifestEntry {
  file: string;
  type: string;
  cache: string;
  sha256: string;
}

interface ResolvedEntry extends ManifestEntry {
  body: Buffer;
  etag: string;
}

/** Total in-memory budget for web assets; the build output is far smaller. */
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

export interface StaticFiles {
  /** Returns true when the request was answered from the allow-list. */
  serve(method: string, pathname: string, ifNoneMatch: string | undefined, res: ServerResponse): boolean;
  /** True when the path is an allow-listed asset (used to answer 405 for other methods). */
  has(pathname: string): boolean;
  readonly available: boolean;
}

function loadManifest(root: string): Map<string, ResolvedEntry> {
  const manifestPath = path.join(root, MANIFEST_FILENAME);
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: unknown; files?: unknown };
  if (parsed.version !== 1 || typeof parsed.files !== 'object' || parsed.files === null) {
    throw new Error('Unsupported static manifest format');
  }
  const map = new Map<string, ResolvedEntry>();
  let total = 0;
  for (const [key, raw] of Object.entries(parsed.files as Record<string, unknown>)) {
    const entry = raw as Partial<ManifestEntry>;
    if (!URL_KEY.test(key)) throw new Error(`Invalid static manifest key: ${key}`);
    if (typeof entry.file !== 'string' || typeof entry.cache !== 'string' || typeof entry.sha256 !== 'string') {
      throw new Error(`Invalid static manifest entry: ${key}`);
    }
    const ext = path.extname(entry.file).toLowerCase();
    const type = ALLOWED_TYPES[ext];
    if (!type || entry.type !== type) throw new Error(`Disallowed static file type: ${key}`);
    const absolutePath = path.resolve(root, entry.file);
    if (!absolutePath.startsWith(root + path.sep) || path.basename(absolutePath).startsWith('.')) {
      throw new Error(`Static manifest entry escapes web root: ${key}`);
    }
    const st = lstatSync(absolutePath);
    if (!st.isFile()) throw new Error(`Static manifest entry is not a regular file: ${key}`);
    total += st.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('Static assets exceed the in-memory budget');
    // Assets are immutable build outputs: load once and verify integrity against the manifest.
    const body = readFileSync(absolutePath);
    if (createHash('sha256').update(body).digest('hex') !== entry.sha256) {
      throw new Error(`Static file does not match its manifest checksum: ${key}`);
    }
    map.set(key, { ...(entry as ManifestEntry), type, body, etag: `"${entry.sha256.slice(0, 32)}"` });
  }
  return map;
}

export function createStaticFiles(webRoot: string, log: Logger, options: { reloadOnChange: boolean }): StaticFiles {
  const root = path.resolve(webRoot);
  const manifestPath = path.join(root, MANIFEST_FILENAME);
  let entries = new Map<string, ResolvedEntry>();
  let loadedMtime = -1;

  const refresh = () => {
    let mtime: number;
    try {
      mtime = statSync(manifestPath).mtimeMs;
    } catch {
      if (loadedMtime !== -2) log.warn('static_manifest_missing', { hint: 'run "npm run build" to build web assets' });
      entries = new Map();
      loadedMtime = -2;
      return;
    }
    if (mtime === loadedMtime) return;
    entries = loadManifest(root);
    loadedMtime = mtime;
    log.info('static_manifest_loaded', { files: entries.size });
  };
  refresh();

  return {
    get available() {
      return entries.size > 0;
    },
    has(pathname) {
      if (options.reloadOnChange) refresh();
      return entries.has(pathname);
    },
    serve(method, pathname, ifNoneMatch, res) {
      if (options.reloadOnChange) refresh();
      const entry = entries.get(pathname);
      if (!entry || (method !== 'GET' && method !== 'HEAD')) return false;
      res.setHeader('Content-Type', entry.type);
      res.setHeader('Cache-Control', entry.cache);
      res.setHeader('ETag', entry.etag);
      if (ifNoneMatch !== undefined && ifNoneMatch === entry.etag) {
        res.statusCode = 304;
        res.end();
        return true;
      }
      res.statusCode = 200;
      res.setHeader('Content-Length', String(entry.body.length));
      res.end(method === 'HEAD' ? undefined : entry.body);
      return true;
    },
  };
}
