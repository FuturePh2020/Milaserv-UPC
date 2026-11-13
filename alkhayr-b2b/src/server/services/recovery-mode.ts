import type { DatabaseSync } from 'node:sqlite';
import { writeTransaction } from '../database/transaction.ts';
import { readSystemState, type SystemState } from '../http/write-gate.ts';

/**
 * Leaving post-restore recovery mode (stage 16). Operator CLI only (`recovery:reopen`), never HTTP.
 * The caller has shown the restore details, run the consistency verifier and collected a reason.
 * One transaction: re-checks that the state is still the one the operator saw (version), opens
 * writes, and appends an audit row with actor NULL (operator procedure) and the reason. The recovery
 * epoch is NOT changed: operations prepared before the restore stay stale for good.
 */
export class RecoveryModeError extends Error {
  readonly code: 'NOT_IN_RECOVERY' | 'STATE_CHANGED';
  constructor(code: RecoveryModeError['code'], message: string) {
    super(message);
    this.name = 'RecoveryModeError';
    this.code = code;
  }
}

export function reopenWrites(db: DatabaseSync, o: { expectedVersion: number; reason: string; now: number; requestId: string }): SystemState {
  return writeTransaction(db, () => {
    const st = readSystemState(db);
    if (st.writeMode !== 'recovery') throw new RecoveryModeError('NOT_IN_RECOVERY', 'The portal is not in recovery mode. Nothing was changed.');
    if (st.version !== o.expectedVersion) throw new RecoveryModeError('STATE_CHANGED', 'The recovery state changed while this command was running. Nothing was changed; run it again.');
    db.prepare("UPDATE system_state SET write_mode = 'open', reopened_at = ?, version = version + 1 WHERE id = 1 AND version = ?").run(o.now, o.expectedVersion);
    db.prepare("INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip_hmac, request_id, created_at) VALUES (NULL, 'recovery.reopened', 'system', NULL, ?, NULL, ?, ?)").run(
      JSON.stringify({ method: 'cli', reason: o.reason, recovery_epoch: st.recoveryEpoch, restored_backup_id: st.restoredBackupId ?? 'unknown' }),
      o.requestId,
      o.now,
    );
    return readSystemState(db);
  });
}
