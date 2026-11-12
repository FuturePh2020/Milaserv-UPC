import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { ConfigError, describeConfig, loadConfig } from './config.ts';
import { createStaticFiles } from './http/static-files.ts';
import { openRuntimeDatabase } from './database/runtime.ts';
import { createLogger } from './logger.ts';

const REQUIRED_NODE_MAJOR = 24;

function main(): void {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < REQUIRED_NODE_MAJOR) {
    process.stderr.write(`ALKHAYR requires Node.js ${REQUIRED_NODE_MAJOR}.x or newer (running ${process.versions.node}).\n`);
    process.exit(1);
  }

  // Files created by this process (database, WAL/SHM, locks) are private to its user.
  process.umask(0o077);

  // Bundled layout: <appRoot>/dist/server/main.js, <appRoot>/dist/web/, <appRoot>/migrations/.
  const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const appRoot = path.resolve(distDir, '..');
  const webRoot = path.join(distDir, 'web');

  let config;
  try {
    config = loadConfig(process.env, { baseDir: appRoot, staticRoot: webRoot });
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'config_invalid', issues: err.issues })}\n`);
      process.exit(1);
    }
    throw err;
  }

  const log = createLogger(config.logLevel);
  const staticFiles = createStaticFiles(webRoot, log, { reloadOnChange: config.nodeEnv === 'development' });
  // Requires an existing, fully migrated database; never creates or migrates one.
  const database = openRuntimeDatabase(config, path.join(appRoot, 'migrations'));
  const app = createApp(config, log, { staticFiles, readiness: database.readiness });

  const server = createServer(
    {
      maxHeaderSize: config.http.maxHeaderBytes,
      headersTimeout: config.http.headersTimeoutMs,
      requestTimeout: config.http.requestTimeoutMs,
      keepAliveTimeout: config.http.keepAliveTimeoutMs,
      // Check header/request timeouts every second instead of Node's 30 s default.
      connectionsCheckingInterval: 1000,
      requireHostHeader: true,
    },
    (req, res) => {
      void app.handle(req, res);
    },
  );
  server.maxRequestsPerSocket = 1000;

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.state.shuttingDown = true;
    log.info('shutdown_started', { signal, graceMs: config.http.shutdownGraceMs });
    const force = setTimeout(() => {
      log.warn('shutdown_forced', { reason: 'grace period elapsed' });
      server.closeAllConnections();
      database.close();
      process.exit(1);
    }, config.http.shutdownGraceMs);
    force.unref();
    server.close((err) => {
      if (err) {
        log.error('shutdown_error', { error: err });
        process.exit(1);
      }
      try {
        database.close();
      } catch (closeErr) {
        log.error('database_close_error', { error: closeErr instanceof Error ? closeErr : String(closeErr) });
        process.exit(1);
      }
      log.info('shutdown_complete');
      process.exit(0);
    });
    server.closeIdleConnections();
  };
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    log.error('uncaught_exception', { error: err });
    process.exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled_rejection', { error: reason instanceof Error ? reason : String(reason) });
    process.exit(1);
  });

  server.on('error', (err) => {
    log.error('server_error', { error: err });
    process.exit(1);
  });

  server.listen(config.port, config.host, () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : config.port;
    log.info('listening', { ...describeConfig(config), port, webAssets: staticFiles.available, schemaVersion: database.schemaVersion });
  });
}

try {
  main();
} catch (err) {
  // Fail closed on any startup error (e.g. tampered web assets) with a structured, secret-free message.
  const message = err instanceof Error ? err.message : String(err);
  const rawCode = (err as { code?: unknown } | null)?.code;
  const code = typeof rawCode === 'string' ? rawCode : undefined;
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level: 'error', event: 'startup_failed', code, message })}\n`);
  process.exit(1);
}
