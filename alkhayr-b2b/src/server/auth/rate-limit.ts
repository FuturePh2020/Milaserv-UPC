import type { DatabaseSync } from 'node:sqlite';
import { writeTransaction } from '../database/transaction.ts';
import { hmacHex } from './keys.ts';

/**
 * Durable fixed-window rate limits stored in `rate_limits` (docs/SECURITY.md §7).
 *
 * - Keys are HMAC(rate-limit key, bucket + identifier): no IP address, username
 *   or password is ever stored or logged.
 * - Growth is bounded: when `maxRows` live keys exist, expired rows are purged;
 *   if the table is still full, NEW identities in that bucket share one
 *   restrictive overflow counter (fail-safe under key-spraying attacks).
 * - Expired rows are also purged periodically (`sweep`), in bounded batches.
 * - Denied attempts do not extend the window; Retry-After = seconds until it ends.
 */

export interface RateLimitRule {
  readonly limit: number;
  readonly windowMs: number;
}

export const DEFAULT_RATE_LIMITS = {
  /** Login attempts per client IP (IPv6: per /64). */
  login_ip: { limit: 20, windowMs: 15 * 60_000 },
  /** Login attempts per username (existing or not). */
  login_account: { limit: 5, windowMs: 15 * 60_000 },
  /** Registrations per client IP. */
  register_ip: { limit: 5, windowMs: 60 * 60_000 },
  /** Password-change attempts per account. */
  password_account: { limit: 5, windowMs: 15 * 60_000 },
  /** Order-creation attempts per merchant (also bounds availability probing). */
  order_create_account: { limit: 30, windowMs: 10 * 60_000 },
  /** All /api requests per client IP. */
  api_ip: { limit: 300, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitBucket = keyof typeof DEFAULT_RATE_LIMITS;
export type RateLimitRules = Record<RateLimitBucket, RateLimitRule>;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiterOptions {
  rules?: Partial<RateLimitRules>;
  /** Maximum live counter rows before overflow sharing (default 100 000). */
  maxRows?: number;
}

const OVERFLOW_IDENTIFIER = '\u0000overflow';

export class RateLimiter {
  readonly rules: RateLimitRules;
  readonly #db: DatabaseSync;
  readonly #key: Buffer;
  readonly #now: () => number;
  readonly #maxRows: number;

  constructor(db: DatabaseSync, key: Buffer, now: () => number, options: RateLimiterOptions = {}) {
    this.#db = db;
    this.#key = key;
    this.#now = now;
    this.rules = { ...DEFAULT_RATE_LIMITS, ...options.rules };
    this.#maxRows = options.maxRows ?? 100_000;
  }

  keyFor(bucket: RateLimitBucket, identifier: string): string {
    return hmacHex(this.#key, `${bucket}\0${identifier}`);
  }

  /** Counts one attempt. Runs in its own write transaction (or the caller's, if one is open). */
  consume(bucket: RateLimitBucket, identifier: string): RateLimitResult {
    const run = () => this.#consume(bucket, identifier);
    return this.#db.isTransaction ? run() : writeTransaction(this.#db, run);
  }

  #consume(bucket: RateLimitBucket, identifier: string): RateLimitResult {
    const rule = this.rules[bucket];
    const now = this.#now();
    let key = this.keyFor(bucket, identifier);
    let row = this.#db.prepare('SELECT count, window_ends_at FROM rate_limits WHERE key = ?').get(key) as { count: number; window_ends_at: number } | undefined;

    if (!row && this.#liveRows(now) >= this.#maxRows) {
      key = this.keyFor(bucket, OVERFLOW_IDENTIFIER);
      row = this.#db.prepare('SELECT count, window_ends_at FROM rate_limits WHERE key = ?').get(key) as typeof row;
    }
    if (row && row.window_ends_at > now) {
      if (row.count >= rule.limit) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((row.window_ends_at - now) / 1000)) };
      this.#db.prepare('UPDATE rate_limits SET count = count + 1 WHERE key = ?').run(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    this.#db
      .prepare('INSERT INTO rate_limits (key, count, window_ends_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_ends_at = excluded.window_ends_at')
      .run(key, now + rule.windowMs);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  #liveRows(now: number): number {
    const count = () => Number((this.#db.prepare('SELECT count(*) AS n FROM rate_limits').get() as { n: number }).n);
    if (count() < this.#maxRows) return count();
    this.#purge(now, 1000);
    return count();
  }

  #purge(now: number, batch: number): number {
    return Number(
      this.#db.prepare('DELETE FROM rate_limits WHERE key IN (SELECT key FROM rate_limits WHERE window_ends_at <= ? LIMIT ?)').run(now, batch).changes,
    );
  }

  /** Forget an identifier's counter (e.g. the account counter after a successful login). */
  reset(bucket: RateLimitBucket, identifier: string): void {
    this.#db.prepare('DELETE FROM rate_limits WHERE key = ?').run(this.keyFor(bucket, identifier));
  }

  /** Periodic cleanup of expired counters; bounded per call. */
  sweep(batch = 5000): number {
    return writeTransaction(this.#db, () => this.#purge(this.#now(), batch));
  }
}
