import { describe, it, expect } from 'vitest';
import { buildTemplateComment } from './templateFallback';
import type { AnalysisFacts } from './facts';

function facts(over: Partial<AnalysisFacts>): AnalysisFacts {
  return {
    status: 'ready',
    generatedAtWall: 0,
    windowDays: 7,
    locale: 'ko-KR',
    anonymousInstallId: 'x',
    dailyGoalMinutes: 60,
    streakCurrent: 0,
    subjects: [],
    ...over,
  };
}

describe('buildTemplateComment — deterministic on-device fallback', () => {
  it('names the worst-deficit subject with a percentage', () => {
    const c = buildTemplateComment(
      facts({
        subjects: [
          { label: '수학', targetMinutes: 420, actualMinutes: 252, lastSessionDaysAgo: 1, missedDayCount: 0 }, // 40% short
          { label: '영어', targetMinutes: 210, actualMinutes: 200, lastSessionDaysAgo: 0, missedDayCount: 0 },
        ],
      }),
    );
    expect(c).toContain('수학');
    expect(c).toContain('40%');
  });

  it('mentions a missed-day streak when >= 2', () => {
    const c = buildTemplateComment(
      facts({
        subjects: [
          { label: '수학', targetMinutes: 420, actualMinutes: 0, lastSessionDaysAgo: 3, missedDayCount: 3 },
        ],
      }),
    );
    expect(c).toContain('3일 연속');
  });

  it('is positive when nothing is meaningfully behind', () => {
    const c = buildTemplateComment(
      facts({
        streakCurrent: 5,
        subjects: [
          { label: '수학', targetMinutes: 420, actualMinutes: 410, lastSessionDaysAgo: 0, missedDayCount: 0 },
        ],
      }),
    );
    expect(c).toContain('5일 연속');
    expect(c).toMatch(/유지|잘 따라가/);
  });

  it('is stable across calls (no randomness)', () => {
    const f = facts({
      subjects: [{ label: '수학', targetMinutes: 420, actualMinutes: 100, lastSessionDaysAgo: 2, missedDayCount: 2 }],
    });
    expect(buildTemplateComment(f)).toBe(buildTemplateComment(f));
  });
});
