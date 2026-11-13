import type { DatabaseSync } from 'node:sqlite';
import type { AppServices } from '../context.ts';
import { orderConsistencyErrors, productConsistencyErrors } from '../database/consistency.ts';
import { AppError } from './errors.ts';
import type { RequestContext } from './router.ts';

/**
 * Business-write gate (stage 16; docs/SECURITY.md §7l, docs/DATABASE.md §18).
 *
 * A NEW business write (not an identical replay of an operation that exists in the data) is accepted
 * only when:
 *   1. writes are open: not in post-restore recovery mode (system_state.write_mode) and not under an
 *      integrity hold (consistency errors found at startup)                 → else 503 WRITES_SUSPENDED
 *   2. the request was prepared under the CURRENT recovery epoch (header X-Recovery-Epoch; absent = 0,
 *      i.e. a browser that never saw a restore)                             → else 409 RECOVERY_EPOCH_STALE
 *   3. the order/products it touches pass the scoped consistency checks     → else 409 CONSISTENCY_HOLD
 * Keyed families call it AFTER their idempotency lookup missed, so an identical retry of an operation
 * that exists in the (restored) data still returns its committed result.
 */

export interface SystemState {
  writeMode: 'open' | 'recovery';
  recoveryEpoch: number;
  restoredBackupId: string | null;
  restoredBackupAt: number | null;
  recoveryStartedAt: number | null;
  reopenedAt: number | null;
  version: number;
}

export function readSystemState(db: DatabaseSync): SystemState {
  const r = db.prepare('SELECT write_mode, recovery_epoch, restored_backup_id, restored_backup_at, recovery_started_at, reopened_at, version FROM system_state WHERE id = 1').get() as
    | { write_mode: 'open' | 'recovery'; recovery_epoch: number; restored_backup_id: string | null; restored_backup_at: number | null; recovery_started_at: number | null; reopened_at: number | null; version: number }
    | undefined;
  // A missing row is impossible after migration 0008 (seeded, undeletable); treat it as closed.
  if (!r) return { writeMode: 'recovery', recoveryEpoch: -1, restoredBackupId: null, restoredBackupAt: null, recoveryStartedAt: null, reopenedAt: null, version: 0 };
  return {
    writeMode: r.write_mode,
    recoveryEpoch: Number(r.recovery_epoch),
    restoredBackupId: r.restored_backup_id,
    restoredBackupAt: r.restored_backup_at === null ? null : Number(r.restored_backup_at),
    recoveryStartedAt: r.recovery_started_at === null ? null : Number(r.recovery_started_at),
    reopenedAt: r.reopened_at === null ? null : Number(r.reopened_at),
    version: Number(r.version),
  };
}

export interface WriteStatus {
  writes: 'open' | 'closed';
  /** Shown to signed-in users only; no detail about what failed. */
  reason: 'recovery' | 'maintenance' | null;
  recoveryEpoch: number;
}

export function writeStatus(services: AppServices): WriteStatus {
  const s = readSystemState(services.db);
  const reason = s.writeMode === 'recovery' ? 'recovery' : services.integrityHold && services.integrityHold.length > 0 ? 'maintenance' : null;
  return { writes: reason ? 'closed' : 'open', reason, recoveryEpoch: s.recoveryEpoch };
}

const EPOCH_PATTERN = /^\d{1,16}$/;

/** The epoch the client prepared this request under (absent header = 0 = never saw a restore). */
export function requestEpoch(ctx: RequestContext): number {
  const raw = ctx.req.headers['x-recovery-epoch'];
  if (raw === undefined) return 0;
  if (typeof raw !== 'string' || !EPOCH_PATTERN.test(raw)) throw new AppError('BAD_REQUEST');
  return Number(raw);
}

export interface WriteScope {
  orderId?: string;
  productIds?: readonly string[];
  /** Pre-login writes (registration) have no prepared operation to be stale. */
  skipEpoch?: boolean;
}

export function assertNewWrite(ctx: RequestContext, scope: WriteScope = {}): void {
  const status = writeStatus(ctx.services);
  if (status.writes === 'closed') {
    ctx.log.info('write_refused', { requestId: ctx.requestId, reason: status.reason });
    throw new AppError('WRITES_SUSPENDED', { headers: { 'Retry-After': '300' } });
  }
  if (!scope.skipEpoch && requestEpoch(ctx) !== status.recoveryEpoch) {
    ctx.log.info('write_refused', { requestId: ctx.requestId, reason: 'stale_recovery_epoch' });
    throw new AppError('RECOVERY_EPOCH_STALE');
  }
  const db = ctx.services.db;
  const codes = [
    ...(scope.orderId ? orderConsistencyErrors(db, scope.orderId) : []),
    ...[...new Set(scope.productIds ?? [])].flatMap((id) => productConsistencyErrors(db, id)),
  ];
  if (codes.length) {
    ctx.log.error('consistency_hold', { requestId: ctx.requestId, codes: [...new Set(codes)].join(',') });
    throw new AppError('CONSISTENCY_HOLD');
  }
}
