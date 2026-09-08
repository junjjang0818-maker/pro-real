import { describe, it, expect, beforeEach } from 'vitest';
import { computeDailyAttendance, attendedDateSet } from './attendance';
import { completedOn, resetIds, MIN, HOUR } from './testFixtures';
import { makeSession, stamp } from '../session/testFixtures';

const GOAL = 60 * MIN;

beforeEach(resetIds);

describe('computeDailyAttendance', () => {
  it('sums counted time per attributed local date and marks attendance at goal', () => {
    const sessions = [
      completedOn('2026-09-06', 30 * MIN),
      completedOn('2026-09-06', 35 * MIN), // 65 total -> attended
      completedOn('2026-09-07', 45 * MIN), // -> not attended
    ];
    const att = computeDailyAttendance({ sessions, defaultGoalMs: GOAL });
    expect(att).toEqual([
      expect.objectContaining({ localDate: '2026-09-06', countedMs: 65 * MIN, attended: true }),
      expect.objectContaining({ localDate: '2026-09-07', countedMs: 45 * MIN, attended: false }),
    ]);
  });

  it('per-date goal override is respected', () => {
    const sessions = [completedOn('2026-09-07', 45 * MIN)];
    const att = computeDailyAttendance({
      sessions,
      defaultGoalMs: GOAL,
      goalMsForDate: (d) => (d === '2026-09-07' ? 40 * MIN : undefined),
    });
    expect(att[0]!.attended).toBe(true);
  });

  it('ignores abandoned sessions', () => {
    const s = completedOn('2026-09-07', 90 * MIN);
    s.status = 'abandoned';
    const att = computeDailyAttendance({ sessions: [s], defaultGoalMs: GOAL });
    expect(att).toEqual([]);
  });
});

describe('computeDailyAttendance — 자정 경계', () => {
  it('a session that crosses local midnight counts ENTIRELY toward its start date', () => {
    // start 23:30 Seoul 2026-09-08, run 90 min -> ends 01:00 on 2026-09-09
    const s = completedOn('2026-09-08', 90 * MIN, { startHour: 23, startMin: 30 });
    const att = computeDailyAttendance({ sessions: [s], defaultGoalMs: GOAL });
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({
      localDate: '2026-09-08',
      countedMs: 90 * MIN,
      attended: true,
      crossedMidnight: true,
    });
  });
});

describe('computeDailyAttendance — 데이터 불일치 방지 (running session included live)', () => {
  it('a still-running session that has passed the goal makes TODAY attended immediately', () => {
    const start = stamp({
      wall: Date.UTC(2026, 8, 8, 1, 0, 0), // 10:00 Seoul
      monotonic: 0,
    });
    const running = makeSession({ start, status: 'running', id: 'run-1' });
    const now = stamp({ wall: start.wall + 61 * MIN, monotonic: 61 * MIN });
    const att = computeDailyAttendance({ sessions: [running], defaultGoalMs: GOAL, now });
    expect(att[0]).toMatchObject({ localDate: '2026-09-08', attended: true });
    expect(att[0]!.countedMs).toBe(61 * MIN);
  });

  it('without `now`, a running session contributes nothing (no crash)', () => {
    const start = stamp({ wall: Date.UTC(2026, 8, 8, 1, 0, 0) });
    const running = makeSession({ start, status: 'running' });
    expect(computeDailyAttendance({ sessions: [running], defaultGoalMs: GOAL })).toEqual([]);
  });
});

describe('attendedDateSet', () => {
  it('collects only attended dates', () => {
    const sessions = [
      completedOn('2026-09-06', 70 * MIN),
      completedOn('2026-09-07', 10 * MIN),
      completedOn('2026-09-08', 61 * MIN),
    ];
    const set = attendedDateSet(computeDailyAttendance({ sessions, defaultGoalMs: GOAL }));
    expect([...set].sort()).toEqual(['2026-09-06', '2026-09-08']);
  });
});

describe('computeDailyAttendance — timezone travel does not re-bucket history', () => {
  it('a session recorded in Seoul stays on its Seoul date even when later sessions are in LA', () => {
    const seoulSession = completedOn('2026-09-08', 70 * MIN, { startHour: 8, tzOffsetMin: 540 });
    // Next day, user is in LA; a session at 2026-09-09 08:00 LA
    const laSession = completedOn('2026-09-09', 70 * MIN, { startHour: 8, tzOffsetMin: -420 });
    const att = computeDailyAttendance({ sessions: [seoulSession, laSession], defaultGoalMs: GOAL });
    expect(att.map((a) => a.localDate)).toEqual(['2026-09-08', '2026-09-09']);
    expect(att.every((a) => a.attended)).toBe(true);
  });
});
