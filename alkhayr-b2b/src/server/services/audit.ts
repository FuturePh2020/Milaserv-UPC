import type { DatabaseSync } from 'node:sqlite';

/**
 * Secret-free audit events. Each action has an allow-list of metadata keys;
 * anything else is dropped. Never pass passwords, OTPs, tokens, cookies,
 * enrollment URIs or request bodies. IPs are stored only as HMAC (ip_hmac).
 */

const METADATA_ALLOW_LIST: Readonly<Record<string, readonly string[]>> = {
  'admin.bootstrap': ['method', 'mfa'],
  'auth.register': [],
  'auth.register_duplicate': [],
  'auth.login': ['role', 'mfa', 'replaced_session'],
  'auth.login_failed': ['reason'],
  'auth.logout': [],
  'auth.password_changed': ['sessions_revoked'],
  'auth.password_change_failed': ['reason'],
  /** Field NAMES only (comma-separated), never values. */
  'merchant.profile_updated': ['fields', 'version'],
  'merchant.status_changed': ['from', 'to', 'reason', 'sessions_revoked', 'version'],
};

export type AuditAction = keyof typeof METADATA_ALLOW_LIST;

export interface AuditEntry {
  actorUserId: string | null;
  action: AuditAction;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, string | number | boolean>;
  ipHmac: string | null;
  requestId: string;
  now: number;
}

export function writeAudit(db: DatabaseSync, e: AuditEntry): void {
  const allowed = METADATA_ALLOW_LIST[e.action];
  if (!allowed) throw new Error(`Unknown audit action: ${e.action}`);
  const meta: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(e.metadata ?? {})) if (allowed.includes(k)) meta[k] = v;
  db.prepare(
    'INSERT INTO audit_logs (actor_user_id, action, target_type, target_id, metadata, ip_hmac, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.actorUserId, e.action, e.targetType ?? null, e.targetId ?? null, Object.keys(meta).length ? JSON.stringify(meta) : null, e.ipHmac, e.requestId, e.now);
}
