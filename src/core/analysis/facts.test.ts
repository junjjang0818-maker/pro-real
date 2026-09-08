import { describe, it, expect, beforeEach } from 'vitest';
import { buildAnalysisFacts, isInsufficient, DATA_REQUIREMENTS } from './facts';
import { completedOn, resetIds, MIN, HOUR } from '../derivations/testFixtures';
import { computeStreak } from '../derivations/streak';
import { computeDailyAttendance } from '../derivations/attendance';
import type { Subject } from '../subjects';

beforeEach(resetIds);

const math: Subject = {
  id: 'math', label: '수학', colorToken: 'red', gestureFingerCount: 1,
  weeklyTargetMs: 7 * HOUR, archivedAt: null, createdAt: 0,
};

function streakFor(sessions: ReturnType<typeof completedOn>[], today: string) {
  return computeStreak({
    attendance: computeDailyAttendance({ sessions, defaultGoalMs: 60 * MIN }),
    today,
  });
}

const base = {
  subjects: [math],
  windowDays: 7 as const,
  dailyGoalMs: 60 * MIN,
  locale: 'ko-KR',
  anonymousInstallId: 'uuid-abc',
};

describe('buildAnalysisFacts — 데이터 부족 가드', () => {
  it('too-new: install < 3 days ago, regardless of session count', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'math', id: `x${i}` }),
    );
    const out = buildAnalysisFacts({
      ...base, sessions, streak: streakFor(sessions, '2026-09-08'),
      installDate: '2026-09-07', today: '2026-09-08',
    });
    expect(isInsufficient(out)).toBe(true);
    if (isInsufficient(out)) expect(out.reason).toBe('too-new');
  });

  it('not-enough-days: enough calendar time & sessions, but < 3 distinct study days', () => {
    const sessions = [
      completedOn('2026-09-07', 30 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'math' }),
    ];
    const out = buildAnalysisFacts({
      ...base, sessions, streak: streakFor(sessions, '2026-09-08'),
      installDate: '2026-09-01', today: '2026-09-08',
    });
    expect(isInsufficient(out) && out.reason).toBe('not-enough-days');
  });

  it('not-enough-sessions: 3 distinct days but < 5 sessions total', () => {
    const sessions = [
      completedOn('2026-09-06', 30 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-07', 30 * MIN, { subjectId: 'math' }),
      completedOn('2026-09-08', 30 * MIN, { subjectId: 'math' }),
    ];
    const out = buildAnalysisFacts({
      ...base, sessions, streak: streakFor(sessions, '2026-09-08'),
      installDate: '2026-09-01', today: '2026-09-08',
    });
    expect(isInsufficient(out) && out.reason).toBe('not-enough-sessions');
  });

  it('reports progress and the needed thresholds', () => {
    const out = buildAnalysisFacts({
      ...base, sessions: [], streak: streakFor([], '2026-09-08'),
      installDate: '2026-09-08', today: '2026-09-08',
    });
    if (!isInsufficient(out)) throw new Error('expected collecting');
    expect(out.progress).toEqual({ distinctStudyDays: 0, totalSessions: 0, daysSinceInstall: 0 });
    expect(out.needed).toEqual(DATA_REQUIREMENTS);
  });
});

describe('buildAnalysisFacts — ready payload (privacy boundary)', () => {
  const sessions = [
    completedOn('2026-09-04', 60 * MIN, { subjectId: 'math' }),
    completedOn('2026-09-05', 60 * MIN, { subjectId: 'math' }),
    completedOn('2026-09-06', 60 * MIN, { subjectId: 'math' }),
    completedOn('2026-09-07', 30 * MIN, { subjectId: 'math' }),
    completedOn('2026-09-08', 30 * MIN, { subjectId: 'math' }),
  ];

  it('produces rounded, aggregate-only fields', () => {
    const out = buildAnalysisFacts({
      ...base, sessions, streak: streakFor(sessions, '2026-09-08'),
      installDate: '2026-09-01', today: '2026-09-08',
    });
    if (isInsufficient(out)) throw new Error('expected ready');
    expect(out.status).toBe('ready');
    expect(out.dailyGoalMinutes).toBe(60);
    expect(out.subjects).toEqual([
      {
        label: '수학',
        targetMinutes: 420,
        actualMinutes: 240, // 60+60+60+30+30
        lastSessionDaysAgo: 0,
        missedDayCount: 0,
      },
    ]);
    // no raw timestamps / ids anywhere in the payload
    const json = JSON.stringify(out);
    expect(json).not.toContain('start');
    expect(json).not.toContain('endWall');
    expect(json).toContain('anonymousInstallId');
  });

  it('carries the install id and locale through unchanged', () => {
    const out = buildAnalysisFacts({
      ...base, sessions, streak: streakFor(sessions, '2026-09-08'),
      installDate: '2026-09-01', today: '2026-09-08',
      anonymousInstallId: 'uuid-xyz', locale: 'ko-KR',
    });
    if (isInsufficient(out)) throw new Error('expected ready');
    expect(out.anonymousInstallId).toBe('uuid-xyz');
    expect(out.locale).toBe('ko-KR');
  });
});
