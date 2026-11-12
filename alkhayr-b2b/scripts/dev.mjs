#!/usr/bin/env node
// Development loop: esbuild watch for server and web, and `node --watch` for
// the server process. Reads .env if present (never committed). Not for production.
import { spawn } from 'node:child_process';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { finalizeWeb, projectRoot, serverOptions, webOptions, build } from './build.mjs';

const outDir = path.join(projectRoot, 'dist');
await build({ dev: true, outDir });

const serverCtx = await esbuild.context(serverOptions({ dev: true, outDir }));
const webCtx = await esbuild.context({
  ...webOptions({ dev: true, outDir }),
  plugins: [
    {
      name: 'alkhayr-finalize-web',
      setup(b) {
        b.onEnd(async (result) => {
          if (result.errors.length === 0 && result.metafile) {
            await finalizeWeb(result.metafile, { dev: true, outDir });
            console.log('[dev] web rebuilt');
          }
        });
      },
    },
  ],
});
await Promise.all([serverCtx.watch(), webCtx.watch()]);

const child = spawn(
  process.execPath,
  ['--watch', '--env-file-if-exists=.env', path.join(outDir, 'server', 'main.js')],
  { cwd: projectRoot, stdio: 'inherit', env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' } },
);
const stop = async () => {
  child.kill('SIGTERM');
  await Promise.all([serverCtx.dispose(), webCtx.dispose()]);
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
