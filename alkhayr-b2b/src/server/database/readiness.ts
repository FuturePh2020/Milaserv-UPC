import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export type ReadinessProbe = () => boolean;

/**
 * Readiness = the opened database is still the file at its configured path,
 * responds to a query, and is at the schema version this release requires.
 * Never throws and never exposes details (callers return a generic 503).
 */
export function createReadinessProbe(db: DatabaseSync, file: string, expectedVersion: number): ReadinessProbe {
  const opened = statSync(file);
  const statement = db.prepare('SELECT max(version) AS version FROM schema_migrations');
  return () => {
    try {
      if (!db.isOpen) return false;
      const current = statSync(file);
      if (current.ino !== opened.ino || current.dev !== opened.dev) return false;
      const row = statement.get() as { version?: unknown } | undefined;
      return row?.version === expectedVersion;
    } catch {
      return false;
    }
  };
}
