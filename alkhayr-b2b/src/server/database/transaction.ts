import type { DatabaseSync } from 'node:sqlite';
import { DatabaseBusyError, isBusyError } from './errors.ts';

/**
 * Transaction helpers. The callback must be SYNCHRONOUS and contain database
 * work only: no awaits, password hashing, network calls or timers, which
 * would hold the write lock open. Nesting is refused (no implicit savepoints;
 * the runtime authorizer also denies SAVEPOINT).
 */

export class NestedTransactionError extends Error {
  constructor() {
    super('A database transaction is already open on this connection; nested transactions are not supported.');
    this.name = 'NestedTransactionError';
  }
}

export class AsyncTransactionError extends Error {
  constructor() {
    super('Transaction callbacks must be synchronous; a Promise was returned and the transaction was rolled back.');
    this.name = 'AsyncTransactionError';
  }
}

type NotPromise<T> = T extends PromiseLike<unknown> ? never : T;

function run<T>(db: DatabaseSync, begin: 'BEGIN IMMEDIATE' | 'BEGIN DEFERRED', fn: () => T): T {
  if (db.isTransaction) throw new NestedTransactionError();
  try {
    db.exec(begin);
  } catch (err) {
    if (isBusyError(err)) throw new DatabaseBusyError(err);
    throw err;
  }
  try {
    const result = fn();
    if (result !== null && typeof result === 'object' && typeof (result as { then?: unknown }).then === 'function') {
      throw new AsyncTransactionError();
    }
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    if (isBusyError(err)) throw new DatabaseBusyError(err);
    throw err;
  }
}

/** Serialized write: BEGIN IMMEDIATE takes the write lock up front (waits up to busy_timeout). */
export function writeTransaction<T>(db: DatabaseSync, fn: () => NotPromise<T>): T {
  return run(db, 'BEGIN IMMEDIATE', fn);
}

/** Consistent multi-statement read snapshot. */
export function readTransaction<T>(db: DatabaseSync, fn: () => NotPromise<T>): T {
  return run(db, 'BEGIN DEFERRED', fn);
}
