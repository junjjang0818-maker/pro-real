import { describe, it, expect } from 'vitest';
import { builtinQuoteForDate, dataDrivenQuotes, pickQuote, quotePool, BUILTIN_QUOTES, type QuoteContext } from './quotes';
import type { StreakResult } from '../../core/derivations/streak';
import type { SubjectStat } from '../../core/derivations/subjectStats';

const streak = (over: Partial<StreakResult> = {}): StreakResult => ({
  current: 0, longest: 0, todayAttended: false, lastAttendedDate: null,
  freezesEarned: 0, freezesUsed: 0, freezesRemaining: 0, usedFreezeDates: [],
  ...over,
});

const stat = (over: Partial<SubjectStat>): SubjectStat => ({
  subjectId: 's', label: '수학', windowDays: 7, targetMs: 100, actualMs: 100,
  deficitMs: 0, deficitPct: 0, lastSessionDate: null, daysSinceLastSession: null,
  consecutiveDaysMissed: 0, sessionCount: 0, ...over,
});

const baseCtx = (over: Partial<QuoteContext> = {}): QuoteContext => ({
  today: '2026-09-08',
  installDate: '2026-09-01',
  streak: streak(),
  subjectStats: [],
  userGoals: [],
  distinctStudyDays: 10,
  ...over,
});

describe('builtinQuoteForDate', () => {
  it('is stable for a given date and rotates across days', () => {
    const a = builtinQuoteForDate('2026-09-08', '2026-09-01');
    const b = builtinQuoteForDate('2026-09-08', '2026-09-01');
    const c = builtinQuoteForDate('2026-09-09', '2026-09-01');
    expect(a).toEqual(b);
    expect(a.text).not.toEqual(c.text);
  });

  it('wraps around the quote list', () => {
    const first = builtinQuoteForDate('2026-09-01', '2026-09-01');
    const wrapped = builtinQuoteForDate(
      new Date(Date.UTC(2026, 8, 1 + BUILTIN_QUOTES.length)).toISOString().slice(0, 10),
      '2026-09-01',
    );
    expect(first.text).toEqual(wrapped.text);
  });
});

describe('dataDrivenQuotes — insufficient-data guard', () => {
  it('returns nothing before 3 distinct study days', () => {
    expect(dataDrivenQuotes(baseCtx({ distinctStudyDays: 2, streak: streak({ current: 5 }) }))).toEqual([]);
  });

  it('mentions the current streak once enough data exists', () => {
    const qs = dataDrivenQuotes(baseCtx({ streak: streak({ current: 5, todayAttended: true }) }));
    expect(qs.some((q) => q.text.includes('5일 연속'))).toBe(true);
  });

  it('nudges the worst-deficit subject', () => {
    const qs = dataDrivenQuotes(
      baseCtx({ subjectStats: [stat({ label: '영어', deficitPct: 0.5 }), stat({ label: '수학', deficitPct: 0.1 })] }),
    );
    expect(qs.some((q) => q.text.includes('영어') && q.text.includes('50%'))).toBe(true);
  });
});

describe('quotePool / pickQuote', () => {
  it('includes user goals when enabled', () => {
    const pool = quotePool(baseCtx({ userGoals: ['서울대 합격', '  '] }));
    expect(pool.some((q) => q.source === 'user-goal' && q.text === '서울대 합격')).toBe(true);
    expect(pool.some((q) => q.text === '')).toBe(false); // blank goal dropped
  });

  it('is never empty even with all sources disabled', () => {
    const pool = quotePool(baseCtx({ sources: { builtin: false, dataDriven: false, userGoal: false } }));
    expect(pool.length).toBeGreaterThan(0);
    expect(pool[0]!.source).toBe('builtin');
  });

  it('pickQuote is deterministic within a day', () => {
    const ctx = baseCtx({ userGoals: ['목표 A', '목표 B'] });
    expect(pickQuote(ctx)).toEqual(pickQuote(ctx));
  });
});
