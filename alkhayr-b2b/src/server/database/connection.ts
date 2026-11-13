import { accessSync, chmodSync, closeSync, constants as fsConstants, existsSync, mkdirSync, openSync, statfsSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { constants as sqlite, DatabaseSync } from 'node:sqlite';
import { DatabaseError } from './errors.ts';

/**
 * SQLite connection policy (docs/DATABASE.md §1).
 * - One application instance, local persistent disk only (network filesystems refused).
 * - WAL, foreign keys, bounded busy timeout, synchronous=FULL, defensive mode.
 * - Directory 0700, database/WAL/SHM files 0600.
 * - Runtime connections get an authorizer that forbids schema changes, ATTACH,
 *   savepoints and PRAGMA writes, so HTTP code cannot alter the schema.
 */

export const APPLICATION_ID = 0x414b4852; // 'AKHR'
export const DEFAULT_BUSY_TIMEOUT_MS = 5000;

// statfs f_type magic numbers of network/remote filesystems on Linux.
const NETWORK_FS_TYPES: Readonly<Record<number, string>> = {
  0x6969: 'nfs',
  0x517b: 'smb',
  0xff534d42: 'cifs',
  0xfe534d42: 'smb2',
  0x00c36400: 'ceph',
  0x5346414f: 'afs',
  0x73757245: 'coda',
  0x564c: 'ncp',
  0x01021997: '9p',
};

export function networkFilesystemName(type: number): string | null {
  return NETWORK_FS_TYPES[type] ?? null;
}

export function assertLocalFilesystem(dir: string): void {
  if (process.platform !== 'linux') return; // magic numbers are Linux-specific
  const type = statfsSync(dir).type;
  const name = networkFilesystemName(type);
  if (name) {
    throw new DatabaseError(
      'NETWORK_FILESYSTEM',
      `The data directory is on a network filesystem (${name}). SQLite requires a local persistent disk; NFS/SMB and shared volumes are not supported.`,
    );
  }
}

/** Create (0700) or tighten the data directory. Refuses group/world access it cannot remove. */
export function ensurePrivateDirectory(dir: string, create: boolean): void {
  if (!existsSync(dir)) {
    if (!create) throw new DatabaseError('DATA_DIR_MISSING', 'The data directory does not exist.');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  if (!statSync(dir).isDirectory()) throw new DatabaseError('DATA_DIR_INVALID', 'The data directory path is not a directory.');
  tightenMode(dir, 0o700);
  // Stage 17: a directory the service user cannot write (wrong owner, read-only mount) is reported clearly
  // instead of surfacing later as a raw SQLite "unable to open database file".
  try {
    accessSync(dir, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    throw new DatabaseError(
      'DATA_DIR_NOT_WRITABLE',
      code === 'EROFS'
        ? 'The data directory is on a read-only filesystem. Mount it read-write.'
        : 'The data directory is not readable and writable by the service user. Fix its ownership (the service runs as uid 1000 in the container) and mode 0700.',
    );
  }
  if (!canWrite(dir)) throw new DatabaseError('DATA_DIR_NOT_WRITABLE', 'The data directory is on a read-only filesystem. Mount it read-write.');
}

/** access(W_OK) does not detect read-only bind mounts reliably; probe with a real exclusive create. */
function canWrite(dir: string): boolean {
  const probe = path.join(dir, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    closeSync(openSync(probe, 'wx', 0o600));
    unlinkSync(probe);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'EROFS' && (err as NodeJS.ErrnoException).code !== 'EACCES';
  }
}

function tightenMode(p: string, mode: number): void {
  if (process.platform === 'win32') return;
  try {
    chmodSync(p, mode);
  } catch {
    // Cannot chmod (not owner): acceptable only if already private.
  }
  if ((statSync(p).mode & 0o077) !== 0) {
    throw new DatabaseError('INSECURE_PERMISSIONS', `Refusing to use ${path.basename(p)}: it is accessible to other users and its permissions cannot be tightened.`);
  }
}

export interface OpenDatabaseOptions {
  /** Refuse to create a new file (server startup, migrate, status). */
  mustExist: boolean;
  /** Install the runtime authorizer (no schema changes, no PRAGMA writes). */
  runtime?: boolean;
  busyTimeoutMs?: number;
}

export function openDatabase(file: string, options: OpenDatabaseOptions): DatabaseSync {
  const dir = path.dirname(file);
  ensurePrivateDirectory(dir, !options.mustExist);
  assertLocalFilesystem(dir);
  if (options.mustExist && !existsSync(file)) {
    throw new DatabaseError('DATABASE_MISSING', 'The database has not been initialized.');
  }
  if (!existsSync(file) && (existsSync(`${file}-wal`) || existsSync(`${file}-shm`))) {
    throw new DatabaseError('STALE_WAL', 'A WAL/SHM file exists without its database file. Refusing to create a new database next to it.');
  }

  const db = new DatabaseSync(file, {
    timeout: options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS,
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    allowExtension: false,
  });
  try {
    configureConnection(db);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) if (existsSync(f)) tightenMode(f, 0o600);
    if (options.runtime) installRuntimeAuthorizer(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

function pragmaValue(db: DatabaseSync, sql: string): unknown {
  const row = db.prepare(sql).get() as Record<string, unknown> | undefined;
  return row ? Object.values(row)[0] : undefined;
}

export function configureConnection(db: DatabaseSync): void {
  db.enableDefensive(true);
  const mode = pragmaValue(db, 'PRAGMA journal_mode = WAL');
  if (mode !== 'wal') throw new DatabaseError('WAL_UNAVAILABLE', `Could not enable WAL journal mode (got ${String(mode)}).`);
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA trusted_schema = OFF');
  db.exec('PRAGMA secure_delete = ON');
  db.exec('PRAGMA journal_size_limit = 67108864');
  if (pragmaValue(db, 'PRAGMA foreign_keys') !== 1) throw new DatabaseError('FOREIGN_KEYS_OFF', 'Foreign-key enforcement could not be enabled.');
}

const DENIED_ACTIONS = new Set<number>([
  sqlite.SQLITE_CREATE_INDEX, sqlite.SQLITE_CREATE_TABLE, sqlite.SQLITE_CREATE_TRIGGER, sqlite.SQLITE_CREATE_VIEW,
  sqlite.SQLITE_CREATE_TEMP_INDEX, sqlite.SQLITE_CREATE_TEMP_TABLE, sqlite.SQLITE_CREATE_TEMP_TRIGGER, sqlite.SQLITE_CREATE_TEMP_VIEW,
  sqlite.SQLITE_DROP_INDEX, sqlite.SQLITE_DROP_TABLE, sqlite.SQLITE_DROP_TRIGGER, sqlite.SQLITE_DROP_VIEW,
  sqlite.SQLITE_DROP_TEMP_INDEX, sqlite.SQLITE_DROP_TEMP_TABLE, sqlite.SQLITE_DROP_TEMP_TRIGGER, sqlite.SQLITE_DROP_TEMP_VIEW,
  sqlite.SQLITE_ALTER_TABLE, sqlite.SQLITE_ATTACH, sqlite.SQLITE_DETACH, sqlite.SQLITE_REINDEX, sqlite.SQLITE_ANALYZE,
  sqlite.SQLITE_CREATE_VTABLE, sqlite.SQLITE_DROP_VTABLE, sqlite.SQLITE_SAVEPOINT,
]);

/** PRAGMAs the runtime may READ. Any PRAGMA assignment is denied. */
const READABLE_PRAGMAS = new Set(['foreign_keys', 'journal_mode', 'user_version', 'application_id', 'data_version', 'quick_check']);

export function installRuntimeAuthorizer(db: DatabaseSync): void {
  db.setAuthorizer((action: number, arg1: string | null, arg2: string | null) => {
    if (DENIED_ACTIONS.has(action)) return sqlite.SQLITE_DENY;
    if (action === sqlite.SQLITE_PRAGMA) {
      return arg2 === null && arg1 !== null && READABLE_PRAGMAS.has(arg1.toLowerCase()) ? sqlite.SQLITE_OK : sqlite.SQLITE_DENY;
    }
    if (action === sqlite.SQLITE_FUNCTION && arg2 !== null && arg2.toLowerCase() === 'load_extension') return sqlite.SQLITE_DENY;
    return sqlite.SQLITE_OK;
  });
}
