/**
 * Database-layer error types and helpers for node:sqlite errors.
 * node:sqlite throws Error objects with code 'ERR_SQLITE_ERROR' and an
 * extended result code in `errcode`.
 */

export const SQLITE = {
  BUSY: 5,
  LOCKED: 6,
  CONSTRAINT_CHECK: 275,
  CONSTRAINT_FOREIGNKEY: 787,
  CONSTRAINT_NOTNULL: 1299,
  CONSTRAINT_PRIMARYKEY: 1555,
  CONSTRAINT_TRIGGER: 1811,
  CONSTRAINT_UNIQUE: 2067,
  CONSTRAINT_DATATYPE: 3091,
  AUTH: 23,
} as const;

export interface SqliteError extends Error {
  code: string;
  errcode: number;
  errstr: string;
}

export function isSqliteError(err: unknown): err is SqliteError {
  return err instanceof Error && (err as Partial<SqliteError>).code === 'ERR_SQLITE_ERROR' && typeof (err as Partial<SqliteError>).errcode === 'number';
}

export function isBusyError(err: unknown): boolean {
  return isSqliteError(err) && ((err.errcode & 0xff) === SQLITE.BUSY || (err.errcode & 0xff) === SQLITE.LOCKED);
}

/** Base class for operator-facing database failures (startup/CLI). */
export class DatabaseError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'DatabaseError';
    this.code = code;
  }
}

/** Raised when a serialized write cannot obtain the write lock within the busy timeout. */
export class DatabaseBusyError extends DatabaseError {
  constructor(cause: unknown) {
    super('DATABASE_BUSY', 'The database is busy; the write lock could not be obtained in time.', { cause });
    this.name = 'DatabaseBusyError';
  }
}

/**
 * Foreign-key violations surface with extended code 787 (CONSTRAINT_FOREIGNKEY)
 * or 1811 (CONSTRAINT_TRIGGER, when SQLite enforces RESTRICT actions through
 * internal trigger programs). Match the message, not the errcode.
 */
export function isForeignKeyError(err: unknown): boolean {
  return isSqliteError(err) && /FOREIGN KEY constraint failed/.test(err.message);
}
