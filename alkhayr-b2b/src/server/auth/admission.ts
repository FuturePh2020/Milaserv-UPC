/**
 * Per-source admission to credential work (stage 16, docs/SECURITY.md §7).
 *
 * The shared password-hash queue is bounded (PasswordHasher maxConcurrent/maxQueue). Without a
 * per-source cap one client could occupy every slot and turn its own requests into a denial of
 * service for everybody else's sign-in. This in-memory counter admits at most `perSource` credential
 * jobs (login, registration) in flight per rate-limit identity (IPv4 address or IPv6 /64); extra
 * concurrent requests from the same source are refused before any hashing.
 *
 * Memory is bounded by the number of requests in flight: an entry exists only while its count > 0.
 * The counter is process-local and resets on restart (it limits concurrency, not attempts; attempts
 * are limited durably by the RateLimiter).
 */
export class CredentialAdmission {
  readonly perSource: number;
  readonly #inFlight = new Map<string, number>();

  constructor(perSource = 2) {
    if (!Number.isInteger(perSource) || perSource < 1) throw new RangeError('perSource must be >= 1');
    this.perSource = perSource;
  }

  /** Returns a release function, or null when the source already has `perSource` jobs in flight. */
  tryAcquire(source: string): (() => void) | null {
    const n = this.#inFlight.get(source) ?? 0;
    if (n >= this.perSource) return null;
    this.#inFlight.set(source, n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.#inFlight.get(source) ?? 1) - 1;
      if (left <= 0) this.#inFlight.delete(source);
      else this.#inFlight.set(source, left);
    };
  }

  /** Sources currently holding at least one slot (diagnostics/tests). */
  get trackedSources(): number {
    return this.#inFlight.size;
  }
}

const perApp = new WeakMap<object, CredentialAdmission>();

/** One admission controller per application instance (keyed by its services object). */
export function admissionFor(services: object): CredentialAdmission {
  let a = perApp.get(services);
  if (!a) {
    a = new CredentialAdmission();
    perApp.set(services, a);
  }
  return a;
}
