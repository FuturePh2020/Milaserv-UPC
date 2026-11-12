#!/usr/bin/env node
// ALKHAYR build: bundles the Node server and the React SPA with esbuild and
// writes dist/web/.static-manifest.json, the ONLY list of files the server
// will serve. No server environment variable is ever passed into the browser
// bundle (only NODE_ENV via `define`); the build fails if `process.env`
// survives in browser output.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED_TYPES = {
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

export function serverOptions({ outDir }) {
  return {
    absWorkingDir: projectRoot,
    // HTTP server and trusted-operator CLI, each bundled standalone.
    entryPoints: { main: 'src/server/main.ts', cli: 'src/server/cli/index.ts' },
    outdir: path.join(outDir, 'server'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    sourcemap: 'linked',
    minify: false,
    legalComments: 'eof',
    logLevel: 'warning',
  };
}

/**
 * Browser bundle. Production uses `src/web/main.tsx` only. Development builds use
 * `src/web/main.dev.tsx`, which additionally registers the component gallery
 * (`#/__gallery`, synthetic fixtures). The gallery modules are never imported by the
 * production entry, so they cannot appear in a release (verified by tests).
 */
export function webOptions({ dev, outDir }) {
  return {
    absWorkingDir: projectRoot,
    entryPoints: [dev ? 'src/web/main.dev.tsx' : 'src/web/main.tsx'],
    outdir: path.join(outDir, 'web', 'assets'),
    publicPath: '/assets',
    entryNames: '[name]-[hash]',
    assetNames: '[name]-[hash]',
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['es2022', 'chrome111', 'firefox115', 'safari16.4'],
    jsx: 'automatic',
    loader: { '.png': 'file', '.svg': 'file', '.woff2': 'file', '.webp': 'file' },
    minify: !dev,
    sourcemap: dev ? 'linked' : false,
    legalComments: 'eof',
    // Emit UTF-8 (Arabic text stays readable and smaller; files are served as utf-8).
    charset: 'utf8',
    metafile: true,
    logLevel: 'warning',
    // The ONLY value injected into browser code. Never add secrets here.
    define: { 'process.env.NODE_ENV': dev ? '"development"' : '"production"' },
  };
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Writes index.html and the static allow-list manifest from esbuild's metafile. */
export async function finalizeWeb(metafile, { dev, outDir }) {
  const webDir = path.join(outDir, 'web');
  const outputs = Object.keys(metafile.outputs).map((p) => path.resolve(projectRoot, p));
  const entryJs = outputs.filter((p) => p.endsWith('.js') && metafile.outputs[path.relative(projectRoot, p)]?.entryPoint);
  const css = outputs.filter((p) => p.endsWith('.css'));
  if (entryJs.length !== 1 || css.length !== 1) {
    throw new Error(`Expected one JS entry and one CSS output, got ${entryJs.length} JS / ${css.length} CSS`);
  }
  const toUrl = (abs) => '/' + path.relative(webDir, abs).split(path.sep).join('/');

  const template = await readFile(path.join(projectRoot, 'public', 'index.html'), 'utf8');
  const html = template.replace('{{JS}}', toUrl(entryJs[0])).replace('{{CSS}}', toUrl(css[0]));
  if (html.includes('{{')) throw new Error('index.html template has unresolved placeholders');
  await writeFile(path.join(webDir, 'index.html'), html);

  const files = {};
  const indexBuf = Buffer.from(html);
  files['/'] = { file: 'index.html', type: ALLOWED_TYPES['.html'], cache: 'no-cache', sha256: sha256(indexBuf) };

  for (const abs of outputs) {
    const ext = path.extname(abs).toLowerCase();
    if (ext === '.map' && !dev) continue;
    const type = ALLOWED_TYPES[ext];
    if (!type) throw new Error(`Build produced a file type that is not allow-listed: ${abs}`);
    const buf = await readFile(abs);
    if ((ext === '.js' || ext === '.css') && /process\.env/.test(buf.toString('utf8'))) {
      throw new Error(`Browser output references process.env: ${abs}`);
    }
    files[toUrl(abs)] = {
      file: path.relative(webDir, abs).split(path.sep).join('/'),
      type,
      cache: dev ? 'no-cache' : 'public, max-age=31536000, immutable',
      sha256: sha256(buf),
    };
  }
  await writeFile(path.join(webDir, '.static-manifest.json'), JSON.stringify({ version: 1, files }, null, 2) + '\n');
  return files;
}

export async function build({ dev = false, outDir = path.join(projectRoot, 'dist') } = {}) {
  outDir = path.resolve(outDir);
  await rm(path.join(outDir, 'server'), { recursive: true, force: true });
  await rm(path.join(outDir, 'web'), { recursive: true, force: true });
  await mkdir(path.join(outDir, 'web'), { recursive: true });
  await esbuild.build(serverOptions({ dev, outDir }));
  // The bundles are ES modules: declare it next to them so Node never has to guess
  // (and never warns) regardless of any package.json around the release.
  await writeFile(path.join(outDir, 'server', 'package.json'), JSON.stringify({ type: 'module', private: true }) + '\n');
  const web = await esbuild.build(webOptions({ dev, outDir }));
  const files = await finalizeWeb(web.metafile, { dev, outDir });
  return { outDir, files };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const dev = args.includes('--dev');
  const outArg = args.find((a) => a.startsWith('--outdir='));
  const started = Date.now();
  const { outDir, files } = await build({ dev, ...(outArg ? { outDir: outArg.slice('--outdir='.length) } : {}) });
  console.log(`Built ${dev ? 'development' : 'production'} bundle in ${Date.now() - started} ms -> ${path.relative(projectRoot, outDir) || outDir}`);
  for (const [url, f] of Object.entries(files)) console.log(`  ${url}  (${f.type})`);
}
