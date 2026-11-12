import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { projectRoot } from './server.ts';

/**
 * TEST-ONLY: compiles browser TSX modules for Node with esbuild (Node's type stripping does not
 * handle JSX) and re-exports React's server renderer from the SAME bundle, so components and
 * renderer share one React instance. Images resolve to file URLs. Nothing is written to the
 * project tree.
 */
export async function loadWebModules<T>(modules: string[]): Promise<T & { renderToStaticMarkup: (el: unknown) => string; createElement: (...args: unknown[]) => unknown }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'alkhayr-web-'));
  const outfile = path.join(dir, 'bundle.mjs');
  const contents = [
    ...modules.map((m) => `export * from ${JSON.stringify(path.join(projectRoot, m))};`),
    "export { renderToStaticMarkup } from 'react-dom/server';",
    "export { createElement } from 'react';",
  ].join('\n');
  try {
    await esbuild.build({
      stdin: { contents, resolveDir: projectRoot, loader: 'ts' },
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      jsx: 'automatic',
      loader: { '.png': 'file' },
      logLevel: 'error',
      // React's Node renderer is CommonJS and requires Node built-ins.
      banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
      define: { 'process.env.NODE_ENV': '"production"' },
    });
    return (await import(pathToFileURL(outfile).href)) as never;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
