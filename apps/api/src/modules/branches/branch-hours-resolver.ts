export interface LegacyWorkingHours {
  from?: string;
  to?: string;
}

export interface WeeklyHoursRow {
  dayOfWeek: number;
  opensAt: string | null;
  closesAt: string | null;
  secondShiftOpensAt: string | null;
  secondShiftClosesAt: string | null;
  isClosed: boolean;
  active: boolean;
}

export interface SpecialHoursRow {
  date: Date;
  opensAt: string | null;
  closesAt: string | null;
  isClosed: boolean;
  active: boolean;
}

function parseMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** true when `minutes` falls in [from, to), wrapping past midnight when to < from. */
function withinWindow(minutes: number, from: string, to: string): boolean {
  const f = parseMinutes(from);
  const t = parseMinutes(to);
  return f <= t ? minutes >= f && minutes < t : minutes >= f || minutes < t;
}

function sameCalendarDate(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Phase 6 §7 — resolves whether a branch is open at `at`, preferring
 * structured data over the legacy single-window JSON field: special
 * hours (today's override, if any) > weekly schedule (today's
 * day-of-week row, if any) > the pre-Phase-6 legacy `{from,to}` field
 * (absent = always open, matching the original behavior exactly so
 * branches with no structured data at all are unaffected).
 */
export function resolveBranchOpenStatus(
  legacy: LegacyWorkingHours | null | undefined,
  weekly: WeeklyHoursRow[],
  special: SpecialHoursRow[],
  at: Date,
): boolean {
  const todaySpecial = special.find((s) => s.active && sameCalendarDate(s.date, at));
  if (todaySpecial) {
    if (todaySpecial.isClosed) return false;
    if (!todaySpecial.opensAt || !todaySpecial.closesAt) return true;
    return withinWindow(at.getHours() * 60 + at.getMinutes(), todaySpecial.opensAt, todaySpecial.closesAt);
  }

  const todayWeekly = weekly.find((w) => w.active && w.dayOfWeek === at.getDay());
  if (todayWeekly) {
    if (todayWeekly.isClosed) return false;
    const minutes = at.getHours() * 60 + at.getMinutes();
    const inFirstShift =
      todayWeekly.opensAt && todayWeekly.closesAt
        ? withinWindow(minutes, todayWeekly.opensAt, todayWeekly.closesAt)
        : true;
    const inSecondShift =
      todayWeekly.secondShiftOpensAt && todayWeekly.secondShiftClosesAt
        ? withinWindow(minutes, todayWeekly.secondShiftOpensAt, todayWeekly.secondShiftClosesAt)
        : false;
    return inFirstShift || inSecondShift;
  }

  if (!legacy?.from || !legacy?.to) return true;
  return withinWindow(at.getHours() * 60 + at.getMinutes(), legacy.from, legacy.to);
}
