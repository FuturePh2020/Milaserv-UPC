import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { cleanStale } from './backup/backup.ts';
import { writeStatus } from './http/write-gate.ts';
import { ConfigError, describeConfig, loadConfig } from './config.ts';
import { createStaticFiles } from './http/static-files.ts';
import { openRuntimeDatabase } from './database/runtime.ts';
import { createLogger } from './logger.ts';
import { deriveServerKeys } from './auth/keys.ts';
import { PasswordHasher } from './auth/passwords.ts';
import { RateLimiter } from './auth/rate-limit.ts';
import { sweepExpiredSessions } from './auth/sessions.ts';
import { writeTransaction } from './database/transaction.ts';

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
  // Sessions, CSRF, rate limits and MFA all need APP_SECRET-derived keys: no fallback, in any mode.
  const keys = deriveServerKeys(config.appSecret);
  const staticFiles = createStaticFiles(webRoot, log, { reloadOnChange: config.nodeEnv === 'development' });
  // Requires an existing, fully migrated database; never creates or migrates one.
  const database = openRuntimeDatabase(config, path.join(appRoot, 'migrations'));
  // Stage 16: remove plaintext staging left by an interrupted backup/verify/restore (only unlocked,
  // managed, owned directories with expected contents; active jobs and anything unexpected are kept).
  try {
    const leftovers = cleanStale(config.dataDir, Date.now());
    if (leftovers.removed.length) log.warn('abandoned_staging_removed', { count: leftovers.removed.length });
    if (leftovers.refused.length) log.warn('staging_left_for_operator', { count: leftovers.refused.length, action: 'inspect with backup:status' });
  } catch (err) {
    log.warn('staging_cleanup_failed', { error: err instanceof Error ? err : String(err) });
  }
  const now = () => Date.now();
  const rateLimiter = new RateLimiter(database.db, keys.rateLimit, now);
  const integrityHold = database.consistency.issues.filter((i) => i.severity === 'error').map((i) => i.code);
  if (integrityHold.length) {
    // Codes and counts only (no ids or data): the operator runs `db:check` for details.
    log.error('consistency_failed', { codes: integrityHold.join(','), counts: database.consistency.issues.map((i) => `${i.code}:${i.count}`).join(','), action: 'new business writes refused; run db:check' });
  } else if (database.consistency.warnings) {
    log.warn('consistency_warnings', { counts: database.consistency.issues.map((i) => `${i.code}:${i.count}`).join(',') });
  }
  const services = { db: database.db, now, hasher: new PasswordHasher(), keys, rateLimiter, integrityHold };
  const app = createApp(config, log, { staticFiles, readiness: database.readiness, services });

  // Bounded periodic cleanup of expired rate-limit counters and sessions.
  const sweeper = setInterval(() => {
    try {
      const counters = rateLimiter.sweep();
      const sessions = writeTransaction(database.db, () => sweepExpiredSessions(database.db, now()));
      if (counters + sessions > 0) log.debug('sweep', { counters, sessions });
    } catch (err) {
      log.warn('sweep_failed', { error: err instanceof Error ? err : String(err) });
    }
  }, 60_000);
  sweeper.unref();

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
    clearInterval(sweeper);
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
    const status = writeStatus(services);
    log.info('listening', { ...describeConfig(config), port, webAssets: staticFiles.available, schemaVersion: database.schemaVersion, administrators: database.administrators, writes: status.writes, writesReason: status.reason, consistencyMs: database.consistency.durationMs });
    if (status.reason === 'recovery') log.warn('recovery_mode', { action: 'reconcile, then run recovery:reopen' });
    if (database.administrators === 0) {
      log.warn('no_administrator', { hint: 'stop the server and run the local setup-admin command to enroll the first administrator' });
    }
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
