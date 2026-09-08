import { describe, it, expect } from 'vitest';
import {
  localDateOf,
  localMinutesOfDay,
  crossesLocalMidnight,
  addLocalDays,
  diffLocalDays,
  compareLocalDate,
  localDateRange,
} from './dayAttribution';

const SEOUL = 540; // +09:00
const LA_DST = -420; // -07:00

describe('localDateOf', () => {
  it('maps an instant to the local calendar date using the given offset', () => {
    // 2026-09-08T15:30:00Z === 2026-09-09 00:30 in Seoul
    const t = Date.UTC(2026, 8, 8, 15, 30, 0);
    expect(localDateOf(t, SEOUL)).toBe('2026-09-09');
    expect(localDateOf(t, 0)).toBe('2026-09-08');
    expect(localDateOf(t, LA_DST)).toBe('2026-09-08');
  });

  it('is stable exactly at local midnight', () => {
    // 2026-09-08T15:00:00Z === 2026-09-09 00:00:00 Seoul
    const midnight = Date.UTC(2026, 8, 8, 15, 0, 0);
    expect(localDateOf(midnight, SEOUL)).toBe('2026-09-09');
    expect(localDateOf(midnight - 1, SEOUL)).toBe('2026-09-08');
  });
});

describe('localMinutesOfDay', () => {
  it('returns minutes since local midnight', () => {
    const t = Date.UTC(2026, 8, 8, 22, 15, 0); // 07:15 Seoul next-day boundary safe
    expect(localMinutesOfDay(t, SEOUL)).toBe(7 * 60 + 15);
  });
});

describe('crossesLocalMidnight — 자정 경계', () => {
  it('detects a session that spans local midnight', () => {
    const start = Date.UTC(2026, 8, 8, 14, 30, 0); // 23:30 Seoul
    const end = Date.UTC(2026, 8, 8, 16, 0, 0); // 01:00 Seoul next day
    expect(crossesLocalMidnight(start, end, SEOUL)).toBe(true);
  });

  it('a session fully inside one local day does not cross', () => {
    const start = Date.UTC(2026, 8, 8, 1, 0, 0); // 10:00 Seoul
    const end = Date.UTC(2026, 8, 8, 3, 0, 0); // 12:00 Seoul
    expect(crossesLocalMidnight(start, end, SEOUL)).toBe(false);
  });
});

describe('date string arithmetic', () => {
  it('addLocalDays handles month/year rollover', () => {
    expect(addLocalDays('2026-09-08', 1)).toBe('2026-09-09');
    expect(addLocalDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addLocalDays('2024-02-28', 1)).toBe('2024-02-29'); // leap year
  });

  it('diffLocalDays is signed and symmetric', () => {
    expect(diffLocalDays('2026-09-10', '2026-09-08')).toBe(2);
    expect(diffLocalDays('2026-09-08', '2026-09-10')).toBe(-2);
    expect(diffLocalDays('2026-03-01', '2026-02-28')).toBe(1);
  });

  it('compareLocalDate sorts lexicographically', () => {
    expect(compareLocalDate('2026-09-08', '2026-09-09')).toBe(-1);
    expect(compareLocalDate('2026-09-09', '2026-09-09')).toBe(0);
    expect(['2026-09-10', '2026-09-08', '2026-09-09'].sort(compareLocalDate)).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
    ]);
  });

  it('localDateRange is inclusive and empty when reversed', () => {
    expect(localDateRange('2026-09-08', '2026-09-11')).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
    ]);
    expect(localDateRange('2026-09-11', '2026-09-08')).toEqual([]);
  });
});

describe('timezone travel — past attribution is frozen', () => {
  it('a session keeps its start-date attribution regardless of a later offset', () => {
    // Session started at 2026-09-08 23:30 Seoul (== 14:30Z).
    const startWall = Date.UTC(2026, 8, 8, 14, 30, 0);
    const attributedAtStart = localDateOf(startWall, SEOUL); // "2026-09-08"

    // User later flies to LA; "now" offset is -420. If we (wrongly) recomputed
    // with the new offset we'd get the previous day. The stored offset prevents that.
    const recomputedWrong = localDateOf(startWall, LA_DST);
    expect(attributedAtStart).toBe('2026-09-08');
    expect(recomputedWrong).toBe('2026-09-08'); // same here, but...

    // A clearer case: 2026-09-09 08:00 Seoul (== 2026-09-08 23:00Z)
    const s2 = Date.UTC(2026, 8, 8, 23, 0, 0);
    expect(localDateOf(s2, SEOUL)).toBe('2026-09-09'); // frozen at start
    expect(localDateOf(s2, LA_DST)).toBe('2026-09-08'); // would drift a day if recomputed
  });
});
