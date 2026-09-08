import { describe, it, expect, beforeEach } from 'vitest';
import { computeStreak, DEFAULT_FREEZE_CONFIG } from './streak';
import { computeDailyAttendance } from './attendance';
import { completedOn, resetIds, MIN } from './testFixtures';

const GOAL = 60 * MIN;

beforeEach(resetIds);

function attendanceFor(dates: string[]) {
  const sessions = dates.map((d) => completedOn(d, 70 * MIN));
  return computeDailyAttendance({ sessions, defaultGoalMs: GOAL });
}

describe('computeStreak — basic', () => {
  it('counts consecutive attended days ending today', () => {
    const attendance = attendanceFor(['2026-09-06', '2026-09-07', '2026-09-08']);
    const r = computeStreak({ attendance, today: '2026-09-08' });
    expect(r.current).toBe(3);
    expect(r.todayAttended).toBe(true);
    expect(r.longest).toBe(3);
    expect(r.lastAttendedDate).toBe('2026-09-08');
  });

  it('today not done yet but yesterday attended => streak reported as of yesterday', () => {
    const attendance = attendanceFor(['2026-09-06', '2026-09-07']);
    const r = computeStreak({ attendance, today: '2026-09-08' });
    expect(r.current).toBe(2);
    expect(r.todayAttended).toBe(false);
  });

  it('neither today nor yesterday attended => current streak 0', () => {
    const attendance = attendanceFor(['2026-09-01', '2026-09-02']);
    const r = computeStreak({ attendance, today: '2026-09-08' });
    expect(r.current).toBe(0);
  });

  it('a hard gap with no freezes ends the streak', () => {
    const attendance = attendanceFor(['2026-09-04', '2026-09-06', '2026-09-07', '2026-09-08']);
    const r = computeStreak({
      attendance,
      today: '2026-09-08',
      freezeConfig: { earnEveryNAttendedDays: 999, maxFreezes: 0 },
    });
    expect(r.current).toBe(3); // 06,07,08 — the 05 gap stops it
  });

  it('longest scans all history, not just the current run', () => {
    const attendance = attendanceFor([
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', // run of 4
      '2026-09-07', '2026-09-08', // run of 2 (current)
    ]);
    const r = computeStreak({
      attendance,
      today: '2026-09-08',
      freezeConfig: { earnEveryNAttendedDays: 999, maxFreezes: 0 },
    });
    expect(r.longest).toBe(4);
    expect(r.current).toBe(2);
  });
});

describe('computeStreak — freezes bridge single missed days', () => {
  it('earns one freeze per 7 attended days (capped at 2)', () => {
    const dates: string[] = [];
    for (let i = 0; i < 16; i++) {
      const d = new Date(Date.UTC(2026, 7, 1));
      d.setUTCDate(d.getUTCDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    const attendance = attendanceFor(dates);
    const r = computeStreak({ attendance, today: dates[dates.length - 1]! });
    expect(r.freezesEarned).toBe(2); // 16/7 = 2 (capped)
  });

  it('a single missed day is bridged by a freeze; the freeze date is recorded', () => {
    // attend 09-01..09-04, miss 09-05, attend 09-06..09-08. Plenty of freezes earned.
    const attendance = attendanceFor([
      '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04',
      '2026-09-06', '2026-09-07', '2026-09-08',
    ]);
    const r = computeStreak({
      attendance,
      today: '2026-09-08',
      freezeConfig: { earnEveryNAttendedDays: 3, maxFreezes: 5 },
    });
    // freeze preserves the count across the gap but does not itself add a day:
    // 09-01..09-04 (4) + 09-06..09-08 (3) = 7
    expect(r.current).toBe(7);
    expect(r.freezesUsed).toBe(1);
    expect(r.usedFreezeDates).toEqual(['2026-09-05']);
  });

  it('two consecutive missed days need two freezes; one is not enough', () => {
    const attendance = attendanceFor([
      '2026-09-01', '2026-09-02', '2026-09-03',
      '2026-09-06', '2026-09-07', '2026-09-08', // 09-04 and 09-05 both missed
    ]);
    const r = computeStreak({
      attendance,
      today: '2026-09-08',
      freezeConfig: { earnEveryNAttendedDays: 3, maxFreezes: 1 }, // only 1 freeze
    });
    expect(r.current).toBe(3); // stops at the 2-day gap
    expect(r.freezesUsed).toBe(0); // can't bridge a 2-day hole with 1
  });
});

describe('computeStreak — 시간대 이동 (travel)', () => {
  it('a day skipped by travelling is treated as a normal miss, bridgeable by a freeze', () => {
    // Suppose the user's local calendar simply has no "2026-09-05" entry.
    const attendance = attendanceFor([
      '2026-09-02', '2026-09-03', '2026-09-04',
      '2026-09-06', '2026-09-07', '2026-09-08',
    ]);
    const withFreeze = computeStreak({
      attendance,
      today: '2026-09-08',
      freezeConfig: { earnEveryNAttendedDays: 3, maxFreezes: 5 },
    });
    expect(withFreeze.current).toBe(6); // 6 attended days, gap bridged
    expect(withFreeze.usedFreezeDates).toEqual(['2026-09-05']);

    const noFreeze = computeStreak({
      attendance,
      today: '2026-09-08',
      freezeConfig: { earnEveryNAttendedDays: 999, maxFreezes: 0 },
    });
    expect(noFreeze.current).toBe(3); // never silently corrupts — just a normal miss
  });
});

describe('DEFAULT_FREEZE_CONFIG', () => {
  it('is 1 per 7 days, max 2', () => {
    expect(DEFAULT_FREEZE_CONFIG).toEqual({ earnEveryNAttendedDays: 7, maxFreezes: 2 });
  });
});
