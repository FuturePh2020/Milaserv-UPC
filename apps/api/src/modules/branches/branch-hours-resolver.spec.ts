import { resolveBranchOpenStatus, type SpecialHoursRow, type WeeklyHoursRow } from './branch-hours-resolver';

// Wednesday 2026-07-22, 10:00 local.
const WED_10AM = new Date(2026, 6, 22, 10, 0);
// Wednesday 2026-07-22, 23:00 local (past a 9-6 window, useful for overnight tests).
const WED_11PM = new Date(2026, 6, 22, 23, 0);

describe('resolveBranchOpenStatus', () => {
  it('falls back to always-open when nothing is configured at all', () => {
    expect(resolveBranchOpenStatus(null, [], [], WED_10AM)).toBe(true);
  });

  it('uses the legacy {from,to} field when no structured rows exist', () => {
    expect(resolveBranchOpenStatus({ from: '09:00', to: '18:00' }, [], [], WED_10AM)).toBe(true);
    expect(resolveBranchOpenStatus({ from: '09:00', to: '18:00' }, [], [], WED_11PM)).toBe(false);
  });

  it('supports an overnight legacy window', () => {
    expect(resolveBranchOpenStatus({ from: '22:00', to: '06:00' }, [], [], WED_11PM)).toBe(true);
    expect(resolveBranchOpenStatus({ from: '22:00', to: '06:00' }, [], [], WED_10AM)).toBe(false);
  });

  it('prefers the weekly schedule over the legacy field when a row exists for the day', () => {
    const weekly: WeeklyHoursRow[] = [
      {
        dayOfWeek: 3, // Wednesday
        opensAt: '12:00',
        closesAt: '20:00',
        secondShiftOpensAt: null,
        secondShiftClosesAt: null,
        isClosed: false,
        active: true,
      },
    ];
    // Legacy says open at 10am; the weekly row (opens at noon) wins.
    expect(resolveBranchOpenStatus({ from: '00:00', to: '23:59' }, weekly, [], WED_10AM)).toBe(false);
  });

  it('treats an isClosed weekly row as closed all day regardless of times', () => {
    const weekly: WeeklyHoursRow[] = [
      {
        dayOfWeek: 3,
        opensAt: '09:00',
        closesAt: '18:00',
        secondShiftOpensAt: null,
        secondShiftClosesAt: null,
        isClosed: true,
        active: true,
      },
    ];
    expect(resolveBranchOpenStatus(null, weekly, [], WED_10AM)).toBe(false);
  });

  it('supports a split (two-shift) weekly schedule', () => {
    const weekly: WeeklyHoursRow[] = [
      {
        dayOfWeek: 3,
        opensAt: '08:00',
        closesAt: '09:30',
        secondShiftOpensAt: '16:00',
        secondShiftClosesAt: '23:30',
        isClosed: false,
        active: true,
      },
    ];
    expect(resolveBranchOpenStatus(null, weekly, [], WED_10AM)).toBe(false); // gap between shifts
    expect(resolveBranchOpenStatus(null, weekly, [], WED_11PM)).toBe(true); // second shift
  });

  it('a special-hours override for today wins over the weekly schedule', () => {
    const weekly: WeeklyHoursRow[] = [
      {
        dayOfWeek: 3,
        opensAt: '09:00',
        closesAt: '18:00',
        secondShiftOpensAt: null,
        secondShiftClosesAt: null,
        isClosed: false,
        active: true,
      },
    ];
    const special: SpecialHoursRow[] = [
      { date: new Date(2026, 6, 22), opensAt: null, closesAt: null, isClosed: true, active: true },
    ];
    expect(resolveBranchOpenStatus(null, weekly, special, WED_10AM)).toBe(false);
  });

  it('an inactive row is ignored, falling through to the next tier', () => {
    const weekly: WeeklyHoursRow[] = [
      {
        dayOfWeek: 3,
        opensAt: '09:00',
        closesAt: '18:00',
        secondShiftOpensAt: null,
        secondShiftClosesAt: null,
        isClosed: false,
        active: false,
      },
    ];
    expect(resolveBranchOpenStatus({ from: '00:00', to: '01:00' }, weekly, [], WED_10AM)).toBe(false);
  });

  it('a special-hours row for a different date does not apply', () => {
    const special: SpecialHoursRow[] = [
      { date: new Date(2026, 6, 23), opensAt: null, closesAt: null, isClosed: true, active: true },
    ];
    expect(resolveBranchOpenStatus(null, [], special, WED_10AM)).toBe(true);
  });
});
