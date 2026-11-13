/**
 * Daily wall-clock schedule in an IANA time zone (stage 17), e.g. times "02:17,14:17" in "Africa/Cairo".
 * DST-aware: a local time that does not exist (spring-forward gap) runs once, within the hour after the gap
 * (never skipped); a repeated local time (fall-back) runs once, at its first occurrence.
 */

export interface DailyTime {
  hour: number;
  minute: number;
}

export function parseDailyTimes(raw: string): DailyTime[] {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 24) throw new Error('BACKUP_SCHEDULE must list 1–24 times like "02:17,14:17"');
  const out: DailyTime[] = [];
  for (const p of parts) {
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(p);
    if (!m) throw new Error(`BACKUP_SCHEDULE: "${p}" is not HH:MM (24-hour)`);
    out.push({ hour: Number(m[1]), minute: Number(m[2]) });
  }
  return out.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
}

export function assertTimeZone(tz: string): string {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return tz;
  } catch {
    throw new Error(`BACKUP_TZ: unknown IANA time zone "${tz}"`);
  }
}

function localParts(ms: number, tz: string) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour), mi: Number(p.minute), s: Number(p.second) };
}

/** UTC instant of local wall time y-mo-d h:mi in tz; inside a DST gap, an instant shortly after the gap. */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const want = Date.UTC(y, mo - 1, d, h, mi);
  let guess = want;
  for (let i = 0; i < 3; i++) {
    const p = localParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    guess += want - asUtc;
  }
  // Inside a gap no instant maps to `want`: step forward (bounded) to a valid local time after it.
  for (let k = 0; k < 180; k++) {
    const p = localParts(guess, tz);
    const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
    if (asUtc >= want) return guess;
    guess += 60_000;
  }
  return guess;
}

/** The next scheduled instant strictly after `afterMs`. */
export function nextRun(afterMs: number, times: DailyTime[], tz: string): number {
  const today = localParts(afterMs, tz);
  for (let dayOffset = 0; dayOffset < 3; dayOffset++) {
    const base = new Date(Date.UTC(today.y, today.mo - 1, today.d + dayOffset));
    for (const t of times) {
      const at = zonedToUtc(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate(), t.hour, t.minute, tz);
      if (at > afterMs) return at;
    }
  }
  throw new Error('no next run found');
}
