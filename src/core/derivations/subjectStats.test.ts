import { describe, it, expect, beforeEach } from 'vitest';
import { computeSubjectStats, rankByDeficit } from './subjectStats';
import { completedOn, resetIds, MIN, HOUR } from './testFixtures';
import type { Subject } from '../subjects';

beforeEach(resetIds);

const math: Subject = {
  id: 'math', label: '수학', colorToken: 'red', gestureFingerCount: 1,
  weeklyTargetMs: 7 * HOUR, archivedAt: null, createdAt: 0,
};
const english: Subject = {
  id: 'eng', label: '영어', colorToken: 'blue', gestureFingerCount: 2,
  weeklyTargetMs: 3.5 * HOUR, archivedAt: null, createdAt: 0,
};

describe('computeSubjectStats', () => {
  it('sums actual time in the window and computes deficit vs scaled target', () => {
    const sessions = [
      completedOn('2026-09-06', 60 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-07', 60 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-08', 60 * MIN, { subjectId: 'math' }), // 3h in last 7d
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'eng' }),
    ];
    const [m, e] = computeSubjectStats({
      sessions, subjects: [math, english], today: '2026-09-08', windowDays: 7,
    });
    expect(m).toMatchObject({ actualMs: 3 * HOUR, targetMs: 7 * HOUR });
    expect(m!.deficitMs).toBe(4 * HOUR);
    expect(m!.deficitPct).toBeCloseTo(4 / 7, 5);
    expect(e).toMatchObject({ actualMs: 30 * MIN, targetMs: 3.5 * HOUR });
  });

  it('excludes sessions outside the window', () => {
    const sessions = [
      completedOn('2026-08-01', 5 * HOUR, { subjectId: 'math' }), // old, ignored
      completedOn('2026-09-08', 60 * MIN, { subjectId: 'math' }),
    ];
    const [m] = computeSubjectStats({
      sessions, subjects: [math], today: '2026-09-08', windowDays: 7,
    });
    expect(m!.actualMs).toBe(60 * MIN);
  });

  it('reports daysSinceLastSession and consecutiveDaysMissed', () => {
    const sessions = [completedOn('2026-09-05', 60 * MIN, { subjectId: 'math' })];
    const [m] = computeSubjectStats({
      sessions, subjects: [math], today: '2026-09-08', windowDays: 7,
    });
    expect(m!.lastSessionDate).toBe('2026-09-05');
    expect(m!.daysSinceLastSession).toBe(3);
    expect(m!.consecutiveDaysMissed).toBe(3); // 09-08, 09-07, 09-06
  });

  it('a subject with no sessions => full deficit, null last session', () => {
    const [m] = computeSubjectStats({
      sessions: [], subjects: [math], today: '2026-09-08', windowDays: 7,
    });
    expect(m).toMatchObject({
      actualMs: 0, deficitPct: 1, lastSessionDate: null, daysSinceLastSession: null,
    });
    expect(m!.consecutiveDaysMissed).toBe(7);
  });

  it('30-day window scales the weekly target up', () => {
    const [m] = computeSubjectStats({
      sessions: [], subjects: [math], today: '2026-09-08', windowDays: 30,
    });
    expect(m!.targetMs).toBe(Math.round((7 * HOUR * 30) / 7));
  });
});

describe('rankByDeficit', () => {
  it('orders worst-behind first', () => {
    const sessions = [
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'math' }), // big deficit
      completedOn('2026-09-08', 3 * HOUR, { subjectId: 'eng' }), // near/over target
    ];
    const stats = computeSubjectStats({
      sessions, subjects: [math, english], today: '2026-09-08', windowDays: 7,
    });
    expect(rankByDeficit(stats).map((s) => s.subjectId)).toEqual(['math', 'eng']);
  });
});
