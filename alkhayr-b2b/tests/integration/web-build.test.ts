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

  test('no credential persistence: the bundles never touch localStorage or sessionStorage', () => {
    assert.doesNotMatch(prod.all, /localStorage|sessionStorage/);
    assert.doesNotMatch(dev.all, /localStorage|sessionStorage/);
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
  test('no raw HTML injection, eval or browser storage anywhere in src/web (React escaping is the XSS control)', async () => {
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(path.join(projectRoot, 'src', 'web'), { recursive: true })).filter((f) => /\.(ts|tsx)$/.test(f));
    assert.ok(files.length > 20);
    for (const f of files) {
      const code = (await readFile(path.join(projectRoot, 'src', 'web', f), 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
      assert.doesNotMatch(code, /dangerouslySetInnerHTML|innerHTML\s*=|\beval\(|new Function\(|localStorage|sessionStorage|document\.cookie/, f);
    }
  });
});
