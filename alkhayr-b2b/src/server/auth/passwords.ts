import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing (docs/SECURITY.md §2).
 *
 * Encoded format (version 1):  $scrypt$v=1$ln=17,r=8,p=1$<salt>$<hash>
 *   ln = log2(N); salt = 16 random bytes; hash = 32-byte scrypt output; both base64url, no padding.
 *
 * Only parameter sets on an explicit allow-list are ever executed, so a stored
 * or attacker-supplied hash cannot request inflated work. Hashing runs on a
 * bounded queue: at most `maxConcurrent` jobs (each needs ~129 MiB) and at most
 * `maxQueue` waiting; more is rejected with PasswordHasherBusyError.
 *
 * Passwords are NFC-normalized (so the same visible password typed with
 * different Unicode compositions matches) and are never trimmed, lowercased or
 * truncated: too-long input is rejected.
 */

export interface ScryptParams {
  readonly ln: number;
  readonly r: number;
  readonly p: number;
}

export const REFERENCE_PARAMS: ScryptParams = Object.freeze({ ln: 17, r: 8, p: 1 });
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const FORMAT_VERSION = 1;

export type PasswordRole = 'admin' | 'trader';
export const PASSWORD_POLICY = Object.freeze({
  minChars: { trader: 12, admin: 15 } as Readonly<Record<PasswordRole, number>>,
  maxChars: 128,
  maxBytes: 512,
});

export class PasswordHasherBusyError extends Error {
  constructor() {
    super('Password hashing capacity exceeded; try again shortly.');
    this.name = 'PasswordHasherBusyError';
  }
}

export class UnsupportedPasswordHashError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Unsupported or malformed password hash: ${reason}`);
    this.name = 'UnsupportedPasswordHashError';
    this.reason = reason;
  }
}

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' });

/** User-perceived characters (grapheme clusters). */
export function countCharacters(value: string): number {
  let n = 0;
  for (const _ of segmenter.segment(value)) n++;
  return n;
}

export type PasswordPolicyIssue = 'not_string' | 'too_short' | 'too_long_chars' | 'too_long_bytes';

/** Validates a candidate NEW password. Returns [] when acceptable. Never modifies it. */
export function checkPasswordPolicy(password: unknown, role: PasswordRole): PasswordPolicyIssue[] {
  if (typeof password !== 'string') return ['not_string'];
  const normalized = password.normalize('NFC');
  const issues: PasswordPolicyIssue[] = [];
  const chars = countCharacters(normalized);
  if (chars < PASSWORD_POLICY.minChars[role]) issues.push('too_short');
  if (chars > PASSWORD_POLICY.maxChars) issues.push('too_long_chars');
  if (Buffer.byteLength(normalized, 'utf8') > PASSWORD_POLICY.maxBytes) issues.push('too_long_bytes');
  return issues;
}

/** True when input is within the size bounds that may be hashed at all (login input). */
function withinHashableBounds(password: string): boolean {
  return Buffer.byteLength(password, 'utf8') <= PASSWORD_POLICY.maxBytes && countCharacters(password) <= PASSWORD_POLICY.maxChars;
}

export function scryptMaxmem(params: ScryptParams): number {
  return 128 * 2 ** params.ln * params.r * params.p + 1024 * 1024;
}

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: scryptMaxmem(params) }, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const B64URL = '[A-Za-z0-9_-]';
const HASH_PATTERN = new RegExp(`^\\$scrypt\\$v=(\\d{1,3})\\$ln=(\\d{1,2}),r=(\\d{1,3}),p=(\\d{1,3})\\$(${B64URL}{22})\\$(${B64URL}{43})$`);

export interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  hash: Buffer;
}

function sameParams(a: ScryptParams, b: ScryptParams): boolean {
  return a.ln === b.ln && a.r === b.r && a.p === b.p;
}

/** Strict parser: exact layout, canonical base64url, allow-listed parameters only. */
export function parsePasswordHash(encoded: unknown, allowed: readonly ScryptParams[] = [REFERENCE_PARAMS]): ParsedHash {
  if (typeof encoded !== 'string' || encoded.length > 200) throw new UnsupportedPasswordHashError('not a bounded string');
  const m = HASH_PATTERN.exec(encoded);
  if (!m) throw new UnsupportedPasswordHashError('layout');
  if (Number(m[1]) !== FORMAT_VERSION) throw new UnsupportedPasswordHashError('format version');
  const params = { ln: Number(m[2]), r: Number(m[3]), p: Number(m[4]) };
  if (!allowed.some((a) => sameParams(a, params))) throw new UnsupportedPasswordHashError('parameters not on the allow-list');
  const salt = Buffer.from(m[5] as string, 'base64url');
  const hash = Buffer.from(m[6] as string, 'base64url');
  if (salt.toString('base64url') !== m[5] || hash.toString('base64url') !== m[6] || salt.length !== SALT_BYTES || hash.length !== KEY_BYTES) {
    throw new UnsupportedPasswordHashError('encoding');
  }
  return { params, salt, hash };
}

export function encodePasswordHash(params: ScryptParams, salt: Buffer, hash: Buffer): string {
  return `$scrypt$v=${FORMAT_VERSION}$ln=${params.ln},r=${params.r},p=${params.p}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export interface PasswordHasherOptions {
  /** Parameters for NEW hashes. Default: reference parameters. */
  params?: ScryptParams;
  /** Parameter sets accepted when verifying. Default: [params]. */
  accepted?: readonly ScryptParams[];
  maxConcurrent?: number;
  maxQueue?: number;
}

export interface PasswordHasherStats {
  active: number;
  queued: number;
  maxActiveObserved: number;
  rejected: number;
}

export class PasswordHasher {
  readonly params: ScryptParams;
  readonly #accepted: readonly ScryptParams[];
  readonly #maxConcurrent: number;
  readonly #maxQueue: number;
  readonly #waiting: Array<() => void> = [];
  #active = 0;
  #maxActiveObserved = 0;
  #rejected = 0;
  #dummyHash: Promise<string> | null = null;

  constructor(options: PasswordHasherOptions = {}) {
    this.params = options.params ?? REFERENCE_PARAMS;
    this.#accepted = options.accepted ?? [this.params];
    this.#maxConcurrent = options.maxConcurrent ?? 2;
    this.#maxQueue = options.maxQueue ?? 32;
    if (!Number.isInteger(this.#maxConcurrent) || this.#maxConcurrent < 1 || !Number.isInteger(this.#maxQueue) || this.#maxQueue < 0) {
      throw new RangeError('maxConcurrent must be >= 1 and maxQueue >= 0');
    }
  }

  stats(): PasswordHasherStats {
    return { active: this.#active, queued: this.#waiting.length, maxActiveObserved: this.#maxActiveObserved, rejected: this.#rejected };
  }

  /** Runs `job` within the concurrency limit; rejects immediately when the queue is full. */
  async #limited<T>(job: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#maxConcurrent) {
      if (this.#waiting.length >= this.#maxQueue) {
        this.#rejected++;
        throw new PasswordHasherBusyError();
      }
      // The finishing job hands its slot over directly (active is not decremented),
      // so a newcomer can never slip in between and exceed the limit.
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    } else {
      this.#active++;
    }
    this.#maxActiveObserved = Math.max(this.#maxActiveObserved, this.#active);
    try {
      return await job();
    } finally {
      const next = this.#waiting.shift();
      if (next) next();
      else this.#active--;
    }
  }

  /** Hashes a NEW password. Caller must have applied checkPasswordPolicy. */
  async hash(password: string): Promise<string> {
    if (typeof password !== 'string' || !withinHashableBounds(password.normalize('NFC'))) {
      throw new RangeError('password exceeds the hashable size bounds');
    }
    const salt = randomBytes(SALT_BYTES);
    const key = await this.#limited(() => derive(password.normalize('NFC'), salt, this.params));
    return encodePasswordHash(this.params, salt, key);
  }

  /**
   * Verifies `password` against a stored hash in constant time.
   * Throws UnsupportedPasswordHashError for malformed/unsupported stored values
   * (no scrypt work is performed for them). Over-long input returns false.
   */
  async verify(password: string, stored: string): Promise<boolean> {
    const parsed = parsePasswordHash(stored, this.#accepted);
    if (typeof password !== 'string') return false;
    const normalized = password.normalize('NFC');
    if (!withinHashableBounds(normalized)) return false;
    const key = await this.#limited(() => derive(normalized, parsed.salt, parsed.params));
    return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
  }

  /**
   * Comparable-cost verification for unknown usernames (stage 04): performs one
   * full scrypt with the current parameters through the same limiter, always false.
   */
  async verifyDummy(password: string): Promise<false> {
    this.#dummyHash ??= this.hash(randomBytes(24).toString('base64url'));
    const dummy = await this.#dummyHash;
    await this.verify(typeof password === 'string' ? password : '', dummy);
    return false;
  }

  /** Exposed for tests/diagnostics: the dummy hash uses the current parameters. */
  async dummyHashForTesting(): Promise<string> {
    this.#dummyHash ??= this.hash(randomBytes(24).toString('base64url'));
    return this.#dummyHash;
  }
}
