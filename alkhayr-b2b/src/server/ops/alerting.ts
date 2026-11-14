import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Alert delivery for the operations watcher (fix B). `ops:status` computes the checks; this module decides WHEN a
 * message is due (state change, recovery, or a periodic reminder while not ok) and delivers it to one webhook.
 *
 * - The webhook URL is a secret (it usually embeds a token): it is read from a protected file, never logged, and
 *   never placed in the payload or the state file.
 * - Payloads carry check names, levels and short details (counts, ages, percentages) — never secrets, file
 *   contents, usernames or customer data. `text` is a one-line summary understood by common chat webhooks.
 * - Delivery is bounded: a timeout per attempt and a fixed number of attempts; failures are recorded and retried
 *   on the next cycle (the alert stays due), never in a tight loop.
 */
export type Level = 'ok' | 'warn' | 'critical';
export interface Check {
  name: string;
  status: Level;
  detail: string;
}
export interface StatusReport {
  time: string;
  overall: Level;
  checks: Check[];
}
export interface WatchState {
  version: 1;
  /** Fingerprint of the last DELIVERED (or, without a webhook, last logged) condition. */
  lastFingerprint: string | null;
  lastOverall: Level | null;
  lastNotifiedAt: number | null;
  lastDelivery: { at: number; ok: boolean; httpStatus: number | null; attempts: number } | null;
  consecutiveDeliveryFailures: number;
}
export const EMPTY_STATE: WatchState = { version: 1, lastFingerprint: null, lastOverall: null, lastNotifiedAt: null, lastDelivery: null, consecutiveDeliveryFailures: 0 };

/** Names and levels of everything that is not ok (details excluded: changing numbers must not re-alert). */
export function fingerprint(report: StatusReport): string {
  return report.checks.filter((c) => c.status !== 'ok').map((c) => `${c.name}:${c.status}`).sort().join(',') || 'ok';
}

export type Due = { due: false } | { due: true; kind: 'problem' | 'changed' | 'recovered' | 'reminder' };

export function alertDue(state: WatchState, report: StatusReport, now: number, reminderMs: number): Due {
  const fp = fingerprint(report);
  if (state.lastFingerprint === null) return fp === 'ok' ? { due: false } : { due: true, kind: 'problem' };
  if (fp !== state.lastFingerprint) return { due: true, kind: fp === 'ok' ? 'recovered' : state.lastFingerprint === 'ok' ? 'problem' : 'changed' };
  if (fp !== 'ok' && state.lastNotifiedAt !== null && now - state.lastNotifiedAt >= reminderMs) return { due: true, kind: 'reminder' };
  return { due: false };
}

export function buildPayload(label: string, kind: string, report: StatusReport, previous: Level | null) {
  const notOk = report.checks.filter((c) => c.status !== 'ok');
  const text =
    kind === 'test'
      ? `[ALKHAYR ${label}] TEST alert — no action needed. Delivery path check.`
      : `[ALKHAYR ${label}] ${kind.toUpperCase()}: ${report.overall}${notOk.length ? ` — ${notOk.map((c) => `${c.name}=${c.status}`).join(', ')}` : ' — all checks ok'}`;
  return { source: 'alkhayr-b2b', label, kind, time: report.time, overall: report.overall, previous, checks: notOk.map((c) => ({ name: c.name, status: c.status, detail: c.detail.slice(0, 200) })), text };
}

export interface DeliveryResult {
  ok: boolean;
  httpStatus: number | null;
  attempts: number;
}

export async function deliver(url: string, payload: unknown, o: { attempts?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch } = {}): Promise<DeliveryResult> {
  const attempts = o.attempts ?? 3;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const f = o.fetchImpl ?? fetch;
  let httpStatus: number | null = null;
  for (let i = 1; i <= attempts; i++) {
    try {
      const r = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(o.timeoutMs ?? 10_000) });
      httpStatus = r.status;
      await r.arrayBuffer().catch(() => undefined);
      if (r.status >= 200 && r.status < 300) return { ok: true, httpStatus, attempts: i };
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) return { ok: false, httpStatus, attempts: i }; // definite refusal
    } catch {
      httpStatus = null;
    }
    if (i < attempts) await sleep(2000 * i);
  }
  return { ok: false, httpStatus, attempts };
}

/** Validates a webhook URL without echoing it. */
export function checkWebhookUrl(raw: string, allowHttp: boolean): { ok: true; url: string } | { ok: false; issue: string } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, issue: 'the alert webhook is not a valid URL' };
  }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) return { ok: false, issue: 'the alert webhook must use https' };
  return { ok: true, url: u.toString() };
}

export function stateFile(backupDir: string): string {
  return path.join(backupDir, 'status', 'ops-watch.json');
}
export function readState(backupDir: string): WatchState {
  try {
    const s = JSON.parse(readFileSync(stateFile(backupDir), 'utf8')) as WatchState;
    return s && s.version === 1 ? { ...EMPTY_STATE, ...s } : { ...EMPTY_STATE };
  } catch {
    return { ...EMPTY_STATE };
  }
}
export function writeState(backupDir: string, state: WatchState): void {
  const file = stateFile(backupDir);
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}
