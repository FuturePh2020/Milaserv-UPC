import type { DatabaseSync } from 'node:sqlite';
import type { ServerKeys } from './auth/keys.ts';
import type { RateLimiter } from './auth/rate-limit.ts';

/** The subset of PasswordHasher used by request handlers (injectable in tests). */
export interface PasswordHashing {
  hash(password: string): Promise<string>;
  verify(password: string, stored: string): Promise<boolean>;
  verifyDummy(password: string): Promise<false>;
}

/** Long-lived dependencies shared by all request handlers. */
export interface AppServices {
  readonly db: DatabaseSync;
  readonly now: () => number;
  readonly hasher: PasswordHashing;
  readonly keys: ServerKeys;
  readonly rateLimiter: RateLimiter;
  /**
   * Consistency error codes found at startup (stage 16). Non-empty = integrity hold: the server serves
   * reads, but refuses every new business write until the operator resolves the issue and restarts.
   */
  readonly integrityHold?: readonly string[];
}
