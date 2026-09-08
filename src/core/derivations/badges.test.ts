import { describe, it, expect, beforeEach } from 'vitest';
import { evaluateBadges, deriveBadgeMetrics, DEFAULT_BADGE_RULES, type BadgeContext } from './badges';
import { computeDailyAttendance } from './attendance';
import { computeStreak } from './streak';
import { completedOn, resetIds, MIN, HOUR } from './testFixtures';

beforeEach(resetIds);

function ctxFrom(sessions: ReturnType<typeof completedOn>[], today = '2026-09-08'): BadgeContext {
  const attendance = computeDailyAttendance({ sessions, defaultGoalMs: 60 * MIN });
  const streak = computeStreak({ attendance, today });
  return { sessions, attendance, streak };
}

describe('deriveBadgeMetrics', () => {
  it('accumulates no-touch time only for untouched sessions', () => {
    const sessions = [
      completedOn('2026-09-08', 40 * MIN, { startSource: 'gesture', screenTouched: false }),
      completedOn('2026-09-08', 30 * MIN, { startSource: 'gesture', screenTouched: true }),
    ];
    const m = deriveBadgeMetrics(ctxFrom(sessions));
    expect(m.totalCountedMs).toBe(70 * MIN);
    expect(m.noTouchCountedMs).toBe(40 * MIN);
    expect(m.gestureStartedCount).toBe(2);
  });

  it('classifies early-bird and night-owl by local start time', () => {
    const sessions = [
      completedOn('2026-09-08', 20 * MIN, { startHour: 6 }), // early bird
      completedOn('2026-09-08', 20 * MIN, { startHour: 23 }), // night owl
      completedOn('2026-09-08', 20 * MIN, { startHour: 2 }), // night owl
    ];
    const m = deriveBadgeMetrics(ctxFrom(sessions));
    expect(m.earlyBirdCount).toBe(1);
    expect(m.nightOwlCount).toBe(2);
  });
});

describe('evaluateBadges — idempotent award (중복 지급 방지)', () => {
  it('awards first-session once, then never again', () => {
    const ctx = ctxFrom([completedOn('2026-09-08', 30 * MIN)]);
    const first = evaluateBadges(ctx, new Set());
    expect(first.newlyAwarded.map((b) => b.id)).toContain('first-session');

    const second = evaluateBadges(ctx, first.awardedNow);
    expect(second.newlyAwarded).toEqual([]);
    expect(second.awardedNow.has('first-session')).toBe(true);
  });

  it('a broken streak does NOT revoke or re-award a streak badge', () => {
    const good = ctxFrom([
      completedOn('2026-09-06', 70 * MIN),
      completedOn('2026-09-07', 70 * MIN),
      completedOn('2026-09-08', 70 * MIN),
    ]);
    const r1 = evaluateBadges(good, new Set());
    expect(r1.newlyAwarded.map((b) => b.id)).toContain('streak-3');

    // later: streak broke (only one distant day attended)
    const bad = ctxFrom([completedOn('2026-09-01', 70 * MIN)], '2026-09-20');
    const r2 = evaluateBadges(bad, r1.awardedNow);
    expect(r2.awardedNow.has('streak-3')).toBe(true); // retained
    expect(r2.newlyAwarded).toEqual([]); // not re-emitted
  });

  it('accumulates newly-awarded ids across several evaluations', () => {
    let awarded = new Set<string>();
    const seen: string[] = [];

    for (let day = 1; day <= 8; day++) {
      const sessions = [];
      for (let d = 1; d <= day; d++) {
        sessions.push(completedOn(`2026-09-0${d}`, 70 * MIN));
      }
      const ctx = ctxFrom(sessions, `2026-09-0${day}`);
      const r = evaluateBadges(ctx, awarded);
      awarded = r.awardedNow;
      seen.push(...r.newlyAwarded.map((b) => b.id));
    }

    // first-session on day 1, streak-3 on day 3, streak-7 on day 7 — each once
    expect(seen.filter((x) => x === 'first-session')).toHaveLength(1);
    expect(seen.filter((x) => x === 'streak-3')).toHaveLength(1);
    expect(seen.filter((x) => x === 'streak-7')).toHaveLength(1);
  });

  it('no-touch cumulative badge fires once the threshold is crossed', () => {
    const under = ctxFrom([
      completedOn('2026-09-08', 40 * MIN, { startSource: 'gesture', screenTouched: false }),
    ]);
    expect(evaluateBadges(under, new Set()).newlyAwarded.map((b) => b.id)).not.toContain('notouch-60m');

    const over = ctxFrom([
      completedOn('2026-09-07', 40 * MIN, { startSource: 'gesture', screenTouched: false }),
      completedOn('2026-09-08', 30 * MIN, { startSource: 'gesture', screenTouched: false }),
    ]);
    expect(evaluateBadges(over, new Set()).newlyAwarded.map((b) => b.id)).toContain('notouch-60m');
  });
});

describe('DEFAULT_BADGE_RULES', () => {
  it('every rule has a unique id and Korean copy', () => {
    const ids = DEFAULT_BADGE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of DEFAULT_BADGE_RULES) {
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.description.length).toBeGreaterThan(0);
    }
  });
});
