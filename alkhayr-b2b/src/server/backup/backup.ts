import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, createReadStream, createWriteStream, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, rmSync, statfsSync, statSync, writeFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { assertAdministratorMfaReadable, SecurityConfigError } from '../auth/mfa-key-check.ts';
import { parseSecret } from '../config.ts';
import { APPLICATION_ID, configureConnection } from '../database/connection.ts';
import { DatabaseError } from '../database/errors.ts';
import { inspectSchema, type Migration } from '../database/migrations.ts';

/**
 * Encrypted backups (stage 15; docs/BACKUP_RECOVERY_AR.md, docs/DATABASE.md §17).
 *
 * Container "AKHRBKP1" (version 1):
 *   magic(8) | headerLength u32 BE (1..4096) | header JSON (UTF-8) | ciphertext | GCM tag(16)
 * - AES-256-GCM (node:crypto / OpenSSL). The per-backup key is HKDF-SHA256(backup key, random 32-byte
 *   salt, info "alkhayr:backup:v1:<backupId>"); the 12-byte nonce is random. Every backup therefore uses
 *   a fresh key and nonce. AAD = magic | length | header, so the metadata is authenticated.
 * - The plaintext is a consistent SQLite snapshot (SQLite online-backup API in ONE step, i.e. under a
 *   single read transaction; WAL content included). Its SHA-256 and size are in the header.
 * - The backup key is 32 random bytes (no password KDF, so no attacker-chosen work factors). It comes
 *   from a protected key file or hidden terminal input — never arguments, environment of the server,
 *   logs or the backup directory. `keyId`/`appSecretId` are short HKDF fingerprints that identify the
 *   right secrets without revealing them.
 * Decryption authenticates only at the end (GCM), so plaintext is written to a private staging file and
 * trusted only after the tag verified; on any failure it is deleted.
 */

export const MAGIC = Buffer.from('AKHRBKP1', 'ascii');
export const MAX_HEADER_BYTES = 4096;
export const MAX_PLAINTEXT_BYTES = 64 * 1024 ** 3; // below the AES-GCM single-message limit
export const BACKUP_NAME = /^alkhayr-(\d{8})-(\d{6})-([0-9a-f]{8})\.akbk$/;
const PARTIAL_NAME = /^\.alkhayr-\d{8}-\d{6}-[0-9a-f]{8}\.akbk\.partial$/;
const STAGING_NAME = /^\.staging-[0-9a-f]{16}$/;
const TAG_BYTES = 16;

export class BackupError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'BackupError';
    this.code = code;
  }
}

const hex = (len: number) => z.string().regex(new RegExp(`^[0-9a-f]{${len}}$`));
const b64u = (bytes: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).refine((s) => Buffer.from(s, 'base64url').length === bytes);

export const headerSchema = z.strictObject({
  format: z.literal('alkhayr-backup'),
  formatVersion: z.literal(1),
  backupId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
  createdAt: z.number().int().min(1).max(8_640_000_000_000_000),
  cipher: z.literal('aes-256-gcm'),
  kdf: z.literal('hkdf-sha256'),
  salt: b64u(32),
  nonce: b64u(12),
  keyId: hex(16),
  appSecretId: hex(16).nullable(),
  applicationId: z.literal(APPLICATION_ID),
  schemaVersion: z.number().int().min(1).max(1000),
  migrations: z.array(z.strictObject({ version: z.number().int().min(1).max(1000), name: z.string().max(100), checksum: hex(64) })).max(1000),
  plaintextBytes: z.number().int().min(512).max(MAX_PLAINTEXT_BYTES),
  plaintextSha256: hex(64),
});
export type BackupHeader = z.infer<typeof headerSchema>;

// ------------------------------------------------------------------ keys and fingerprints

/** Short public identifier of a backup key (HKDF; reveals nothing usable about the key). */
export function keyId(backupKey: Buffer): string {
  return Buffer.from(hkdfSync('sha256', backupKey, Buffer.alloc(0), 'alkhayr:backup-key-id:v1', 8)).toString('hex');
}

/** Short public identifier of an APP_SECRET, recorded in each backup so a restore can check the secret. */
export function appSecretId(appSecret: Buffer): string {
  return Buffer.from(hkdfSync('sha256', appSecret, Buffer.alloc(0), 'alkhayr:app-secret-id:v1', 8)).toString('hex');
}

function fileKey(backupKey: Buffer, salt: Buffer, backupId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', backupKey, salt, `alkhayr:backup:v1:${backupId}`, 32));
}

/** Parses a key (base64url, 32 bytes, real entropy) — same rules as other server secrets. */
export function parseBackupKey(raw: string): Buffer {
  const r = parseSecret('Backup key', raw.trim());
  if (typeof r === 'string') throw new BackupError('KEY_INVALID', r);
  if (r.length !== 32) throw new BackupError('KEY_INVALID', 'Backup key must decode to exactly 32 bytes (base64url).');
  return r;
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Reads a backup key file. It must be a regular file (not a symlink), owned by the current user,
 * without any group/other permission bits, small, and outside the data and backup directories.
 */
export function readKeyFile(file: string, forbiddenDirs: readonly string[]): Buffer {
  let st;
  try {
    st = lstatSync(file);
  } catch {
    throw new BackupError('KEY_FILE_MISSING', 'The key file does not exist or cannot be read.');
  }
  if (st.isSymbolicLink() || !st.isFile()) throw new BackupError('KEY_FILE_INSECURE', 'The key file must be a regular file (symbolic links are refused).');
  if (process.platform !== 'win32') {
    if (typeof process.getuid === 'function' && st.uid !== process.getuid()) throw new BackupError('KEY_FILE_INSECURE', 'The key file must be owned by the user running this command.');
    if ((st.mode & 0o077) !== 0) throw new BackupError('KEY_FILE_INSECURE', 'The key file is readable or writable by other users; restrict it with: chmod 600 <file>.');
  }
  if (st.size > 256) throw new BackupError('KEY_FILE_INVALID', 'The key file is too large to be a backup key.');
  const real = realpathSync(file);
  for (const dir of forbiddenDirs) {
    if (existsSync(dir) && inside(real, realpathSync(dir))) throw new BackupError('KEY_FILE_LOCATION', 'The key file must not be stored in the data directory or the backup directory.');
  }
  return parseBackupKey(readFileSync(file, 'utf8'));
}

/** Creates a NEW key file (0600, never overwrites) and returns its key id. */
export function writeNewKeyFile(file: string, forbiddenDirs: readonly string[]): string {
  const dir = path.dirname(path.resolve(file));
  if (!existsSync(dir)) throw new BackupError('KEY_FILE_LOCATION', 'The directory for the key file does not exist.');
  for (const d of forbiddenDirs) {
    if (existsSync(d) && inside(realpathSync(dir), realpathSync(d))) throw new BackupError('KEY_FILE_LOCATION', 'The key file must not be stored in the data directory or the backup directory.');
  }
  const key = randomBytes(32);
  let fd: number;
  try {
    fd = openSync(file, 'wx', 0o600);
  } catch {
    throw new BackupError('KEY_FILE_EXISTS', 'A file already exists at that path; key files are never overwritten.');
  }
  try {
    writeFileSync(fd, `${key.toString('base64url')}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const id = keyId(key);
  key.fill(0);
  return id;
}

// ------------------------------------------------------------------ filesystem helpers

export function ensurePrivateDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = lstatSync(dir);
  if (st.isSymbolicLink() || !st.isDirectory()) throw new BackupError('DIR_INVALID', `${path.basename(dir)} must be a real directory (not a symbolic link).`);
  if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) {
    try {
      chmodSync(dir, 0o700);
    } catch {
      /* not the owner */
    }
    if ((statSync(dir).mode & 0o077) !== 0) throw new BackupError('DIR_INSECURE', `${path.basename(dir)} is accessible to other users and cannot be restricted.`);
  }
}

function writeAll(fd: number, buf: Buffer): void {
  for (let off = 0; off < buf.length; ) off += writeSync(fd, buf, off, buf.length - off);
}

function fsyncDir(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    /* not supported on every platform */
  }
}

/** A private staging directory inside `parent` (same filesystem, so a final rename is atomic). */
export function makeStaging(parent: string): string {
  ensurePrivateDir(parent);
  const dir = path.join(parent, `.staging-${randomBytes(8).toString('hex')}`);
  mkdirSync(dir, { mode: 0o700 });
  return dir;
}

/** Removes stale managed staging directories / partial files (never symlinks, never other names). */
export function cleanStale(dir: string, maxAgeMs: number, now: number): string[] {
  if (!existsSync(dir)) return [];
  const removed: string[] = [];
  for (const name of readdirSync(dir)) {
    if (!STAGING_NAME.test(name) && !PARTIAL_NAME.test(name)) continue;
    const p = path.join(dir, name);
    const st = lstatSync(p);
    if (st.isSymbolicLink()) continue;
    if (now - st.mtimeMs < maxAgeMs) continue;
    if (STAGING_NAME.test(name) && st.isDirectory()) rmSync(p, { recursive: true, force: true });
    else if (PARTIAL_NAME.test(name) && st.isFile()) rmSync(p, { force: true });
    else continue;
    removed.push(name);
  }
  return removed;
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), new Transform({ transform(chunk, _e, cb) { h.update(chunk); cb(); } }));
  return h.digest('hex');
}

// ------------------------------------------------------------------ snapshot

/**
 * Consistent snapshot of the live database through SQLite's online-backup API, copying ALL pages in
 * one step (one read transaction): concurrent writers continue (WAL) and the copy reflects exactly one
 * committed state. The source connection is read-only.
 */
export async function snapshotDatabase(databasePath: string, target: string): Promise<void> {
  if (!existsSync(databasePath)) throw new BackupError('DATABASE_MISSING', 'No database found to back up.');
  const src = new DatabaseSync(databasePath, { readOnly: true, timeout: 5000 });
  try {
    await sqliteBackup(src, target, { rate: 2_147_483_647 });
  } finally {
    src.close();
  }
}

// ------------------------------------------------------------------ database verification

export interface VerifyOptions {
  migrations: readonly Migration[];
  /** APP_SECRET to test administrator MFA decryption; null skips (reported). */
  appSecret: Buffer | null;
  /** Explicit, documented acceptance that the APP_SECRET differs (case E). */
  acceptNewAppSecret?: boolean;
}

export interface VerifySummary {
  schemaVersion: number;
  pendingMigrations: string[];
  counts: Record<string, number>;
  checks: string[];
  mfa: 'readable' | 'no_administrators' | 'not_checked' | 'unreadable_accepted';
}

const count = (db: DatabaseSync, table: string) => Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n);

/**
 * Read-only verification of a database FILE (decrypted backup or snapshot): identity, SQLite integrity,
 * foreign keys, migration history/checksums, stock/ledger/allocation/import invariants and (optionally)
 * administrator MFA decryptability with the supplied APP_SECRET. Stage-09 consistency gaps that need
 * cross-history reasoning are NOT checked here (stage 16).
 */
export function verifyDatabaseFile(file: string, o: VerifyOptions): VerifySummary {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch {
    throw new BackupError('DB_UNREADABLE', 'The backup does not contain a readable SQLite database.');
  }
  const checks: string[] = [];
  try {
    let appId: number;
    try {
      appId = Number(Object.values(db.prepare('PRAGMA application_id').get() as object)[0]);
    } catch {
      throw new BackupError('DB_UNREADABLE', 'The backup does not contain a readable SQLite database.');
    }
    if (appId !== APPLICATION_ID) throw new BackupError('DB_FOREIGN', 'The backup does not contain an ALKHAYR database.');
    checks.push('application_id');
    const integrity = (db.prepare('PRAGMA integrity_check').all() as Array<Record<string, unknown>>).map((r) => String(Object.values(r)[0]));
    if (!(integrity.length === 1 && integrity[0] === 'ok')) throw new BackupError('DB_CORRUPT', `SQLite integrity_check failed (${integrity.length} problem(s)).`);
    checks.push('integrity_check');
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    if (fk.length > 0) throw new BackupError('DB_CORRUPT', `SQLite foreign_key_check reported ${fk.length} violation(s).`);
    checks.push('foreign_key_check');
    let state;
    try {
      state = inspectSchema(db, o.migrations);
    } catch (err) {
      if (err instanceof DatabaseError) throw new BackupError('SCHEMA_INCOMPATIBLE', `${err.code}: ${err.message}`);
      throw err;
    }
    if (state.kind === 'uninitialized') throw new BackupError('SCHEMA_INCOMPATIBLE', 'The backed-up database has no schema.');
    checks.push('migration_history');
    const problems: string[] = [];
    const q = (sql: string) => Number((db.prepare(sql).get() as { n: number }).n);
    const badLink = q(`SELECT count(*) AS n FROM products p LEFT JOIN inventory_ledger l ON l.id = p.last_ledger_id
                        WHERE (p.last_ledger_id IS NULL AND (p.on_hand <> 0 OR p.reserved <> 0))
                           OR (p.last_ledger_id IS NOT NULL AND (l.id IS NULL OR l.product_id <> p.id OR l.on_hand_after <> p.on_hand OR l.reserved_after <> p.reserved))`);
    if (badLink) problems.push(`${badLink} product(s) whose balance does not match its last ledger row`);
    const badSum = q(`SELECT count(*) AS n FROM products p
                       WHERE p.on_hand <> coalesce((SELECT sum(on_hand_delta) FROM inventory_ledger l WHERE l.product_id = p.id), 0)
                          OR p.reserved <> coalesce((SELECT sum(reserved_delta) FROM inventory_ledger l WHERE l.product_id = p.id), 0)`);
    if (badSum) problems.push(`${badSum} product(s) whose balance differs from the sum of its ledger`);
    const badAlloc = q(`SELECT count(*) AS n FROM products p
                         WHERE p.reserved <> coalesce((SELECT sum(quantity) FROM order_allocations a WHERE a.product_id = p.id AND a.status = 'reserved'), 0)`);
    if (badAlloc) problems.push(`${badAlloc} product(s) whose reserved stock differs from their open allocations`);
    if (state.version >= 6) {
      const badImport = q(`SELECT count(*) AS n FROM import_operations o WHERE o.record_count <> (SELECT count(*) FROM import_operation_items i WHERE i.import_id = o.id)`);
      if (badImport) problems.push(`${badImport} import operation(s) whose items do not match their record count`);
    }
    const adminNoMfa = q("SELECT count(*) AS n FROM auth_users WHERE role = 'admin' AND totp_ciphertext IS NULL");
    if (adminNoMfa) problems.push(`${adminNoMfa} administrator(s) without MFA`);
    if (problems.length) throw new BackupError('INVARIANT_FAILED', `Application invariants failed: ${problems.join('; ')}.`);
    checks.push('stock_ledger_allocation_import_invariants');
    let mfa: VerifySummary['mfa'] = 'not_checked';
    if (o.appSecret || !o.acceptNewAppSecret) {
      try {
        mfa = assertAdministratorMfaReadable(db, o.appSecret).administrators === 0 ? 'no_administrators' : 'readable';
        checks.push('administrator_mfa_decryptable');
      } catch (err) {
        if (!(err instanceof SecurityConfigError)) throw err;
        if (!o.acceptNewAppSecret) throw new BackupError('APP_SECRET_MISMATCH', 'Administrator MFA secrets in this backup cannot be decrypted with the supplied APP_SECRET. Configure the APP_SECRET that belongs to this backup.');
        mfa = 'unreadable_accepted';
      }
    }
    const tables = ['auth_users', 'merchants', 'products', 'orders', 'order_items', 'order_events', 'order_allocations', 'inventory_ledger', 'audit_logs', 'sessions'];
    if (state.version >= 6) tables.push('import_operations', 'import_operation_items');
    const counts = Object.fromEntries(tables.map((t) => [t, count(db, t)]));
    return { schemaVersion: state.version, pendingMigrations: state.kind === 'pending' ? state.pending.map((m) => m.filename) : [], counts, checks, mfa };
  } catch (err) {
    // A damaged b-tree can make any query fail; report a generic, safe code instead of a raw SQLite error.
    if (!(err instanceof BackupError) && (err as { code?: string }).code === 'ERR_SQLITE_ERROR') throw new BackupError('DB_CORRUPT', 'The backed-up database is damaged (SQLite reported an error while verifying it).');
    throw err;
  } finally {
    db.close();
  }
}

// ------------------------------------------------------------------ container

export interface ReadHeaderResult {
  header: BackupHeader;
  headerBytes: Buffer;
  aad: Buffer;
  ciphertextOffset: number;
  fileBytes: number;
}

/** Reads and strictly validates the authenticated-but-not-yet-verified header (bounded reads). */
export function readHeader(file: string): ReadHeaderResult {
  let fd: number;
  try {
    const st = lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) throw new BackupError('NOT_A_BACKUP', 'The path is not a regular backup file.');
    fd = openSync(file, 'r');
  } catch (err) {
    if (err instanceof BackupError) throw err;
    throw new BackupError('NOT_FOUND', 'The backup file does not exist or cannot be read.');
  }
  try {
    const size = fstatSync(fd).size;
    const prefix = Buffer.alloc(12);
    if (size < 12 || readSync(fd, prefix, 0, 12, 0) !== 12) throw new BackupError('NOT_A_BACKUP', 'The file is too short to be an ALKHAYR backup.');
    if (!prefix.subarray(0, 6).equals(MAGIC.subarray(0, 6))) throw new BackupError('NOT_A_BACKUP', 'The file is not an ALKHAYR backup (unknown format).');
    if (!prefix.subarray(0, 8).equals(MAGIC)) throw new BackupError('VERSION_UNSUPPORTED', 'This backup format version is not supported by this release.');
    const headerLength = prefix.readUInt32BE(8);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES) throw new BackupError('HEADER_INVALID', 'The backup header length is out of bounds.');
    if (size < 12 + headerLength + TAG_BYTES) throw new BackupError('TRUNCATED', 'The backup file is truncated.');
    const headerBytes = Buffer.alloc(headerLength);
    readSync(fd, headerBytes, 0, headerLength, 12);
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(headerBytes));
    } catch {
      throw new BackupError('HEADER_INVALID', 'The backup header is not valid JSON.');
    }
    if (typeof json === 'object' && json !== null && (json as { formatVersion?: unknown }).formatVersion !== 1) {
      throw new BackupError('VERSION_UNSUPPORTED', 'This backup format version is not supported by this release.');
    }
    const parsed = headerSchema.safeParse(json);
    if (!parsed.success) throw new BackupError('HEADER_INVALID', 'The backup header is invalid or out of bounds.');
    const ciphertextOffset = 12 + headerLength;
    if (size - ciphertextOffset - TAG_BYTES !== parsed.data.plaintextBytes) {
      throw new BackupError('TRUNCATED', 'The backup file size does not match its header (truncated or extended).');
    }
    return { header: parsed.data, headerBytes, aad: Buffer.concat([prefix, headerBytes]), ciphertextOffset, fileBytes: size };
  } finally {
    closeSync(fd);
  }
}

/** Decrypts into `target` (0600); throws (and deletes target) unless the GCM tag and plaintext hash verify. */
export async function decryptBackup(file: string, backupKey: Buffer, target: string): Promise<BackupHeader> {
  const h = readHeader(file);
  if (h.header.keyId !== keyId(backupKey)) throw new BackupError('KEY_MISMATCH', `This backup was encrypted with a different backup key (key id ${h.header.keyId}).`);
  const tag = Buffer.alloc(TAG_BYTES);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, tag, 0, TAG_BYTES, h.fileBytes - TAG_BYTES);
  } finally {
    closeSync(fd);
  }
  const decipher = createDecipheriv('aes-256-gcm', fileKey(backupKey, Buffer.from(h.header.salt, 'base64url'), h.header.backupId), Buffer.from(h.header.nonce, 'base64url'));
  decipher.setAAD(h.aad);
  decipher.setAuthTag(tag);
  const hash = createHash('sha256');
  try {
    await pipeline(
      createReadStream(file, { start: h.ciphertextOffset, end: h.fileBytes - TAG_BYTES - 1 }),
      decipher,
      new Transform({ transform(chunk, _e, cb) { hash.update(chunk); cb(null, chunk); } }),
      createWriteStream(target, { flags: 'wx', mode: 0o600 }),
    );
  } catch {
    rmSync(target, { force: true });
    throw new BackupError('AUTH_FAILED', 'The backup could not be authenticated: wrong key, or the file was modified or damaged. Nothing was restored.');
  }
  if (hash.digest('hex') !== h.header.plaintextSha256) {
    rmSync(target, { force: true });
    throw new BackupError('AUTH_FAILED', 'The decrypted content does not match the backup header.');
  }
  return h.header;
}

export interface CreatedBackup {
  file: string;
  header: BackupHeader;
  summary: VerifySummary;
}

function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

/**
 * Creates, encrypts and VERIFIES a backup: snapshot → verify snapshot → encrypt to a partial file
 * (0600, exclusive) → fsync → atomic rename → decrypt the final file again and verify it → marker.
 * Any failure removes the partial/new file; existing backups are never touched.
 */
export async function createBackup(o: {
  databasePath: string;
  dataDir: string;
  backupDir: string;
  backupKey: Buffer;
  appSecret: Buffer | null;
  migrations: readonly Migration[];
  now: () => number;
}): Promise<CreatedBackup> {
  ensurePrivateDir(o.backupDir);
  cleanStale(o.backupDir, 3_600_000, o.now());
  cleanStale(o.dataDir, 3_600_000, o.now());
  const staging = makeStaging(o.dataDir);
  const t = o.now();
  const backupId = randomUUID();
  const name = `alkhayr-${stamp(t)}-${backupId.slice(0, 8)}.akbk`;
  const final = path.join(o.backupDir, name);
  const partial = path.join(o.backupDir, `.${name}.partial`);
  let renamed = false;
  try {
    const snap = path.join(staging, 'snapshot.db');
    await snapshotDatabase(o.databasePath, snap);
    const summary = verifyDatabaseFile(snap, { migrations: o.migrations, appSecret: o.appSecret });
    const plaintextBytes = statSync(snap).size;
    const header: BackupHeader = {
      format: 'alkhayr-backup',
      formatVersion: 1,
      backupId,
      createdAt: t,
      cipher: 'aes-256-gcm',
      kdf: 'hkdf-sha256',
      salt: randomBytes(32).toString('base64url'),
      nonce: randomBytes(12).toString('base64url'),
      keyId: keyId(o.backupKey),
      appSecretId: o.appSecret ? appSecretId(o.appSecret) : null,
      applicationId: APPLICATION_ID,
      schemaVersion: summary.schemaVersion,
      migrations: o.migrations.slice(0, summary.schemaVersion).map((m) => ({ version: m.version, name: m.name, checksum: m.checksum })),
      plaintextBytes,
      plaintextSha256: await sha256File(snap),
    };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerBytes.length > MAX_HEADER_BYTES) throw new BackupError('HEADER_INVALID', 'Backup header too large.');
    const prefix = Buffer.alloc(12);
    MAGIC.copy(prefix, 0);
    prefix.writeUInt32BE(headerBytes.length, 8);
    const cipher = createCipheriv('aes-256-gcm', fileKey(o.backupKey, Buffer.from(header.salt, 'base64url'), backupId), Buffer.from(header.nonce, 'base64url'));
    cipher.setAAD(Buffer.concat([prefix, headerBytes]));
    // Exclusive create (never overwrites), 0600; plain synchronous chunked loop, then fsync.
    const out = openSync(partial, 'wx', 0o600);
    const inp = openSync(snap, 'r');
    try {
      writeAll(out, prefix);
      writeAll(out, headerBytes);
      const chunk = Buffer.alloc(1024 * 1024);
      for (let n = readSync(inp, chunk, 0, chunk.length, null); n > 0; n = readSync(inp, chunk, 0, chunk.length, null)) {
        writeAll(out, cipher.update(chunk.subarray(0, n)));
      }
      writeAll(out, cipher.final());
      writeAll(out, cipher.getAuthTag());
      fsyncSync(out);
    } finally {
      closeSync(inp);
      closeSync(out);
    }
    renameSync(partial, final);
    renamed = true;
    fsyncDir(o.backupDir);
    rmSync(snap, { force: true });
    // Prove the FINAL file decrypts and verifies (not just that encryption ran).
    const check = path.join(staging, 'verify.db');
    await decryptBackup(final, o.backupKey, check);
    const verified = verifyDatabaseFile(check, { migrations: o.migrations, appSecret: o.appSecret });
    await writeMarker(final, header);
    return { file: final, header, summary: verified };
  } catch (err) {
    rmSync(partial, { force: true });
    if (renamed) rmSync(final, { force: true });
    throw err;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ verification markers and rotation

async function writeMarker(file: string, header: BackupHeader): Promise<void> {
  const marker = `${file}.verified`;
  const body = JSON.stringify({ backupId: header.backupId, sha256: await sha256File(file), verifiedAt: Date.now() });
  const tmp = `${marker}.tmp-${randomBytes(4).toString('hex')}`;
  writeFileSync(tmp, body, { mode: 0o600, flag: 'wx' });
  renameSync(tmp, marker);
}

export async function markVerified(file: string, header: BackupHeader): Promise<void> {
  rmSync(`${file}.verified`, { force: true });
  await writeMarker(file, header);
}

async function isVerified(file: string): Promise<boolean> {
  const marker = `${file}.verified`;
  try {
    const st = lstatSync(marker);
    if (!st.isFile()) return false;
    const m = JSON.parse(readFileSync(marker, 'utf8')) as { sha256?: unknown };
    return typeof m.sha256 === 'string' && m.sha256 === (await sha256File(file));
  } catch {
    return false;
  }
}

export interface ManagedBackup {
  name: string;
  file: string;
  bytes: number;
  mtimeMs: number;
}

/** Managed backups only: regular files (no symlinks) whose names match the exact backup pattern, newest first. */
export function listBackups(backupDir: string): ManagedBackup[] {
  if (!existsSync(backupDir)) return [];
  const out: ManagedBackup[] = [];
  for (const name of readdirSync(backupDir)) {
    if (!BACKUP_NAME.test(name)) continue;
    const file = path.join(backupDir, name);
    const st = lstatSync(file);
    if (st.isSymbolicLink() || !st.isFile()) continue;
    out.push({ name, file, bytes: st.size, mtimeMs: st.mtimeMs });
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/**
 * Keeps the newest `keep` managed backups and, in addition, always the newest VERIFIED backup.
 * Deletes only managed backup files and their markers; never symlinks or other files.
 */
export async function pruneBackups(backupDir: string, keep: number): Promise<{ kept: string[]; deleted: string[]; newestVerified: string | null }> {
  if (!Number.isSafeInteger(keep) || keep < 1 || keep > 1000) throw new BackupError('USAGE', '--keep must be a whole number from 1 to 1000.');
  const all = listBackups(backupDir);
  let newestVerified: string | null = null;
  for (const b of all) {
    if (await isVerified(b.file)) {
      newestVerified = b.name;
      break;
    }
  }
  const kept: string[] = [];
  const deleted: string[] = [];
  all.forEach((b, i) => {
    if (i < keep || b.name === newestVerified) kept.push(b.name);
    else {
      rmSync(b.file, { force: true });
      const marker = `${b.file}.verified`;
      if (existsSync(marker) && lstatSync(marker).isFile()) rmSync(marker, { force: true });
      deleted.push(b.name);
    }
  });
  if (deleted.length) fsyncDir(backupDir);
  return { kept, deleted, newestVerified };
}

// ------------------------------------------------------------------ restore

export interface RestoreResult {
  header: BackupHeader;
  summary: VerifySummary;
  previousMovedTo: string | null;
  sessionsRemoved: number;
}

/**
 * Restores a backup into `dataDir` (the caller holds the instance lock, so no server runs there).
 * Decrypt + verify into a private staging directory of the TARGET data directory; then, on the
 * staged copy only: remove every session (old browser access never revives) and append a
 * `backup.restored` audit row (actor NULL = operator/system). Only then is the target replaced:
 * the previous database (checkpointed) is MOVED aside into `pre-restore-<stamp>/`, never deleted.
 */
export async function restoreBackup(o: {
  file: string;
  backupKey: Buffer;
  dataDir: string;
  databasePath: string;
  migrations: readonly Migration[];
  appSecret: Buffer | null;
  replace: boolean;
  acceptNewAppSecret: boolean;
  now: () => number;
}): Promise<RestoreResult> {
  const targetExists = existsSync(o.databasePath);
  if (targetExists && !o.replace) {
    throw new BackupError('TARGET_EXISTS', 'A database already exists in the target data directory. Nothing was changed. Restore into a new DATA_DIR, or re-run with --replace (the current database is kept aside, not deleted).');
  }
  const h = readHeader(o.file);
  if (o.appSecret && h.header.appSecretId && h.header.appSecretId !== appSecretId(o.appSecret) && !o.acceptNewAppSecret) {
    throw new BackupError('APP_SECRET_MISMATCH', `This backup belongs to a different APP_SECRET (secret id ${h.header.appSecretId}). Configure that APP_SECRET. Nothing was changed.`);
  }
  if (h.header.schemaVersion > o.migrations.length) throw new BackupError('SCHEMA_TOO_NEW', 'The backup was made by a newer release; restore it with that release. Nothing was changed.');
  ensurePrivateDir(o.dataDir);
  cleanStale(o.dataDir, 3_600_000, o.now());
  const staging = makeStaging(o.dataDir);
  try {
    const staged = path.join(staging, path.basename(o.databasePath));
    await decryptBackup(o.file, o.backupKey, staged);
    const summary = verifyDatabaseFile(staged, { migrations: o.migrations, appSecret: o.appSecret, acceptNewAppSecret: o.acceptNewAppSecret });
    // Neutralize restored access on the STAGED copy (maintenance connection, not the runtime one).
    const db = new DatabaseSync(staged, { enableForeignKeyConstraints: true });
    let sessionsRemoved = 0;
    try {
      configureConnection(db);
      db.exec('BEGIN IMMEDIATE');
      try {
        sessionsRemoved = Number(db.prepare('DELETE FROM sessions').run().changes);
        db.prepare(
          "INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip_hmac, request_id, created_at) VALUES (NULL, 'backup.restored', 'backup', ?, ?, NULL, ?, ?)",
        ).run(h.header.backupId.slice(0, 36), JSON.stringify({ method: 'cli', backup_created_at: h.header.createdAt, schema_version: h.header.schemaVersion, sessions_removed: sessionsRemoved, mfa: summary.mfa }), randomUUID(), Math.max(o.now(), h.header.createdAt + 1));
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      db.close();
    }
    for (const sfx of ['-wal', '-shm']) rmSync(`${staged}${sfx}`, { force: true });
    let previousMovedTo: string | null = null;
    if (targetExists) {
      // Fold the old WAL into the old file, then move the whole previous database aside (never delete).
      const old = new DatabaseSync(o.databasePath, { timeout: 5000 });
      try {
        old.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } finally {
        old.close();
      }
      previousMovedTo = path.join(o.dataDir, `pre-restore-${stamp(o.now())}-${randomBytes(3).toString('hex')}`);
      mkdirSync(previousMovedTo, { mode: 0o700 });
      for (const sfx of ['', '-wal', '-shm']) {
        const f = `${o.databasePath}${sfx}`;
        if (existsSync(f)) renameSync(f, path.join(previousMovedTo, path.basename(f)));
      }
    }
    try {
      renameSync(staged, o.databasePath);
    } catch (err) {
      if (previousMovedTo) {
        for (const sfx of ['', '-wal', '-shm']) {
          const moved = path.join(previousMovedTo, `${path.basename(o.databasePath)}${sfx}`);
          if (existsSync(moved)) renameSync(moved, `${o.databasePath}${sfx}`);
        }
      }
      throw err;
    }
    fsyncDir(o.dataDir);
    return { header: h.header, summary, previousMovedTo, sessionsRemoved };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------------ diagnostics

export async function backupStatus(o: { backupDir: string; dataDir: string; databasePath: string; now: number }) {
  const backups = listBackups(o.backupDir);
  let newestVerified: ManagedBackup | null = null;
  for (const b of backups) {
    if (await isVerified(b.file)) {
      newestVerified = b;
      break;
    }
  }
  const newest = backups[0] ?? null;
  const fileSize = (f: string) => (existsSync(f) ? statSync(f).size : 0);
  const tables: Record<string, number> = {};
  if (existsSync(o.databasePath)) {
    const db = new DatabaseSync(o.databasePath, { readOnly: true });
    try {
      for (const t of ['audit_logs', 'inventory_ledger', 'orders', 'order_events', 'import_operations', 'import_operation_items', 'sessions', 'rate_limits']) {
        try {
          tables[t] = count(db, t);
        } catch {
          /* table absent in an older schema */
        }
      }
    } finally {
      db.close();
    }
  }
  const stale = [o.backupDir, o.dataDir].flatMap((d) => (existsSync(d) ? readdirSync(d).filter((n) => STAGING_NAME.test(n) || PARTIAL_NAME.test(n)) : []));
  let freeBytes: number | null = null;
  try {
    const fs = statfsSync(existsSync(o.backupDir) ? o.backupDir : o.dataDir);
    freeBytes = fs.bavail * fs.bsize;
  } catch {
    freeBytes = null;
  }
  const age = (b: ManagedBackup | null) => (b ? Math.round((o.now - b.mtimeMs) / 1000) : null);
  const warnings: string[] = [];
  if (!newestVerified) warnings.push('no verified backup exists');
  else if (o.now - newestVerified.mtimeMs > 26 * 3_600_000) warnings.push('newest verified backup is older than 26 hours');
  if (stale.length) warnings.push(`${stale.length} interrupted backup/restore leftover(s) (removed automatically after one hour by the next backup)`);
  return {
    backupDir: o.backupDir,
    backups: backups.length,
    totalBackupBytes: backups.reduce((s, b) => s + b.bytes, 0),
    newest: newest ? { name: newest.name, ageSeconds: age(newest) } : null,
    newestVerified: newestVerified ? { name: newestVerified.name, ageSeconds: age(newestVerified) } : null,
    database: { bytes: fileSize(o.databasePath), walBytes: fileSize(`${o.databasePath}-wal`) },
    rows: tables,
    freeBytes,
    leftovers: stale,
    warnings,
  };
}
