import assert from 'node:assert/strict';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { projectRoot } from '../helpers/server.ts';
import { CONTENT_SECURITY_POLICY } from '../../src/server/http/security-headers.ts';

// Release/preview separation and asset policy of the browser bundle (stage 10).
interface Manifest {
  files: Record<string, { file: string; type: string }>;
}
let root: string;
const read = async (mode: 'prod' | 'dev') => {
  const dir = path.join(root, mode, 'web');
  const manifest = JSON.parse(await readFile(path.join(dir, '.static-manifest.json'), 'utf8')) as Manifest;
  const text: Record<string, string> = {};
  for (const [url, f] of Object.entries(manifest.files)) {
    // Served code only (source maps of the dev build embed original sources and comments).
    if (/^text\//.test(f.type)) text[url] = await readFile(path.join(dir, f.file), 'utf8');
  }
  return { manifest, text, all: Object.values(text).join('\n') };
};
let prod: Awaited<ReturnType<typeof read>>;
let dev: Awaited<ReturnType<typeof read>>;

before(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'alkhayr-webbuild-'));
  const build = (await import(path.join(projectRoot, 'scripts', 'build.mjs'))) as { build(o: { dev?: boolean; outDir: string }): Promise<unknown> };
  await build.build({ dev: false, outDir: path.join(root, 'prod') });
  await build.build({ dev: true, outDir: path.join(root, 'dev') });
  prod = await read('prod');
  dev = await read('dev');
});
after(() => rm(root, { recursive: true, force: true }));

describe('browser bundle: previews, storage and assets', () => {
  test('the component gallery and synthetic fixtures exist only in the development build', () => {
    for (const marker of ['ALKHAYR-SYNTHETIC-PREVIEW-FIXTURE', '__gallery', 'معرض مكونات', 'منتج تجريبي']) {
      assert.equal(prod.all.includes(marker), false, `production contains ${marker}`);
      assert.equal(dev.all.includes(marker), true, `development lacks ${marker}`);
    }
  });

  test('no credential persistence: sessionStorage is never used; localStorage only under the draft key prefix', () => {
    for (const bundle of [prod.all, dev.all]) {
      assert.doesNotMatch(bundle, /sessionStorage/);
      // Every localStorage access in the bundle belongs to the draft module (key prefix alkhayr.v1.draft.).
      assert.match(bundle, /alkhayr\.v1\.draft\./);
      assert.equal((bundle.match(/localStorage/g) ?? []).length, 1, 'single storage accessor');
    }
  });

  test('assets are local and allow-listed: fonts are woff2 from /assets, no remote stylesheet, script or font', () => {
    const urls = Object.keys(prod.manifest.files);
    const fonts = urls.filter((u) => u.endsWith('.woff2'));
    assert.equal(fonts.length, 8);
    for (const f of fonts) assert.equal(prod.manifest.files[f]!.type, 'font/woff2');
    const css = Object.entries(prod.text).find(([u]) => u.endsWith('.css'))![1];
    const cssUrls = [...css.matchAll(/url\(([^)]+)\)/g)].map((m) => m[1]!.replace(/["']/g, ''));
    assert.ok(cssUrls.length >= 8);
    for (const u of cssUrls) assert.match(u, /^\/assets\/[\w.-]+\.woff2$/);
    assert.match(css, /SIL Open Font License 1\.1/, 'font licence notice preserved in the CSS');
    // No stylesheet imports at all (esbuild keeps remote @import as `@import "https://…"`).
    assert.doesNotMatch(css, /@import/);
    const html = prod.text['/']!;
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /<script(?![^>]*type="module" src="\/assets\/)/);
    assert.doesNotMatch(html, /style=|<style/);
    assert.match(html, /<html lang="ar" dir="rtl">/);
  });

  test('the Content-Security-Policy is unchanged: no unsafe-inline, unsafe-eval or remote origins', () => {
    assert.equal(
      CONTENT_SECURITY_POLICY,
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  });

  test('no source maps or development entry in production', () => {
    assert.equal(Object.keys(prod.manifest.files).some((u) => u.endsWith('.map') || u.includes('main.dev')), false);
    assert.equal(Object.keys(dev.manifest.files).some((u) => u.includes('main.dev')), true);
  });
});

describe('browser source rules', () => {
  test('no raw HTML injection, eval or cookie access in src/web; browser storage only in the draft module (React escaping is the XSS control)', async () => {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(path.join(projectRoot, 'src', 'web'), { recursive: true })).filter((f) => /\.(ts|tsx)$/.test(f));
    assert.ok(files.length > 20);
    const DRAFT_MODULE = path.join('cart', 'storage.ts');
    for (const f of files) {
      const code = (await readFile(path.join(projectRoot, 'src', 'web', f), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML\s*=|\beval\(|new Function\(|document\.cookie/, f);
      // Keys must come from the CSPRNG only (client.ts newRequestKey): no weak randomness anywhere.
      assert.doesNotMatch(code, /Math\.random/, f);
      if (f !== DRAFT_MODULE) assert.doesNotMatch(code, /localStorage|sessionStorage/, `${f}: browser storage is only allowed in ${DRAFT_MODULE}`);
    }
    // The draft module stores order drafts only: never tokens, passwords or authenticator codes.
    const draft = (await readFile(path.join(projectRoot, 'src', 'web', DRAFT_MODULE), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    assert.doesNotMatch(draft, /csrf|token|password|totp|session|buyer/i);
    assert.doesNotMatch(draft, /sessionStorage/);
  });
});
