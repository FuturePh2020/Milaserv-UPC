import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DatabaseError, isBusyError } from './errors.ts';
import { ensurePrivateDirectory } from './connection.ts';

export const INSTANCE_LOCK_FILENAME = 'alkhayr.instance.lock';

export interface InstanceLock {
  release(): void;
}

/**
 * Ensures only ONE server or schema-maintenance process uses a data directory.
 * Holds an exclusive SQLite (fcntl) lock on a sidecar file for the process
 * lifetime; the OS releases it automatically if the process dies, so there is
 * no stale-lock cleanup. Read-only commands (db:status) do not take it.
 */
export function acquireInstanceLock(dataDir: string, purpose: string): InstanceLock {
  ensurePrivateDirectory(dataDir, true);
  const lockDb = new DatabaseSync(path.join(dataDir, INSTANCE_LOCK_FILENAME), { timeout: 0 });
  try {
    lockDb.exec('PRAGMA locking_mode = EXCLUSIVE');
    lockDb.exec('BEGIN EXCLUSIVE');
  } catch (err) {
    lockDb.close();
    if (isBusyError(err)) {
      throw new DatabaseError(
        'INSTANCE_LOCKED',
        `Cannot start ${purpose}: another ALKHAYR server or maintenance command is already using this data directory. Only one instance may use a database.`,
        { cause: err },
      );
    }
    throw err;
  }
  let released = false;
  return {
    release() {
      if (released) return;
      released = true;
      try {
        lockDb.exec('ROLLBACK');
      } finally {
        lockDb.close();
      }
    },
  };
}
