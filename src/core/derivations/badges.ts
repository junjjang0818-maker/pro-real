import type { Session } from '../session/types';
import { computeElapsed } from '../session/elapsed';
import { localMinutesOfDay } from '../time/dayAttribution';
import type { DailyAttendance } from './attendance';
import type { StreakResult } from './streak';

/**
 * Badges are PURE DERIVATIONS evaluated after each session transition, and
 * award is IDEMPOTENT: `newlyAwarded = qualifies − alreadyAwarded`, keyed by id.
 *
 * Re-running with more data can only ADD ids, never re-emit an already-awarded
 * one. A metric dipping back below a threshold (e.g. a broken streak) does NOT
 * revoke a badge and does NOT re-award it later. This is what prevents the
 * "duplicate celebration notification" problem at the source.
 */

export interface BadgeContext {
  streak: StreakResult;
  attendance: DailyAttendance[];
  sessions: Session[];
}

export interface DerivedBadgeMetrics {
  totalCountedMs: number;
  noTouchCountedMs: number; // sum over sessions the user never touched the screen during
  gestureStartedCount: number;
  completedCount: number;
  earlyBirdCount: number; // sessions started before 05:00–07:59 local
  nightOwlCount: number; // sessions started 22:00–03:59 local
  daysGoalHit: number;
}

export function deriveBadgeMetrics(ctx: BadgeContext): DerivedBadgeMetrics {
  let totalCountedMs = 0;
  let noTouchCountedMs = 0;
  let gestureStartedCount = 0;
  let completedCount = 0;
  let earlyBirdCount = 0;
  let nightOwlCount = 0;

  for (const s of ctx.sessions) {
    if (s.status !== 'completed' && s.status !== 'recovered') continue;
    completedCount += 1;
    const { countedMs } = computeElapsed(
      { start: s.start, pauses: s.pauses, endWall: s.endWall },
      s.start,
    );
    totalCountedMs += countedMs;
    if (!s.screenTouchedDuringSession) noTouchCountedMs += countedMs;
    if (s.startSource === 'gesture') gestureStartedCount += 1;

    const mins = localMinutesOfDay(s.start.wall, s.start.tzOffsetMin);
    if (mins >= 5 * 60 && mins < 8 * 60) earlyBirdCount += 1;
    if (mins >= 22 * 60 || mins < 4 * 60) nightOwlCount += 1;
  }

  return {
    totalCountedMs,
    noTouchCountedMs,
    gestureStartedCount,
    completedCount,
    earlyBirdCount,
    nightOwlCount,
    daysGoalHit: ctx.attendance.filter((a) => a.attended).length,
  };
}

export interface BadgeRule {
  id: string;
  title: string;
  description: string;
  /** does the user currently qualify? */
  test: (m: DerivedBadgeMetrics, ctx: BadgeContext) => boolean;
}

const H = 60 * 60 * 1000;

export const DEFAULT_BADGE_RULES: BadgeRule[] = [
  {
    id: 'first-session',
    title: '첫 걸음',
    description: '첫 학습 세션을 완료했어요',
    test: (m) => m.completedCount >= 1,
  },
  {
    id: 'streak-3',
    title: '3일 연속',
    description: '3일 연속 출석',
    test: (_m, c) => c.streak.current >= 3,
  },
  {
    id: 'streak-7',
    title: '일주일 개근',
    description: '7일 연속 출석',
    test: (_m, c) => c.streak.current >= 7,
  },
  {
    id: 'streak-30',
    title: '한 달 개근',
    description: '30일 연속 출석',
    test: (_m, c) => c.streak.current >= 30,
  },
  {
    id: 'notouch-60m',
    title: '무접촉 1시간',
    description: '화면을 만지지 않은 세션 시간 누적 1시간',
    test: (m) => m.noTouchCountedMs >= 1 * H,
  },
  {
    id: 'notouch-10h',
    title: '무접촉 10시간',
    description: '화면을 만지지 않은 세션 시간 누적 10시간',
    test: (m) => m.noTouchCountedMs >= 10 * H,
  },
  {
    id: 'gesture-10',
    title: '제스처 마스터',
    description: '제스처로 세션을 10번 시작',
    test: (m) => m.gestureStartedCount >= 10,
  },
  {
    id: 'early-bird-5',
    title: '아침형 인간',
    description: '아침(05–08시) 세션 5회',
    test: (m) => m.earlyBirdCount >= 5,
  },
];

export interface BadgeAward {
  id: string;
  title: string;
  description: string;
}

export interface EvaluateBadgesResult {
  /** ids that currently qualify OR were already awarded (never shrinks). */
  awardedNow: Set<string>;
  /** qualifies AND not previously awarded — enqueue exactly one notification per. */
  newlyAwarded: BadgeAward[];
}

export function evaluateBadges(
  ctx: BadgeContext,
  alreadyAwarded: ReadonlySet<string>,
  rules: BadgeRule[] = DEFAULT_BADGE_RULES,
): EvaluateBadgesResult {
  const metrics = deriveBadgeMetrics(ctx);
  const awardedNow = new Set<string>(alreadyAwarded);
  const newlyAwarded: BadgeAward[] = [];

  for (const rule of rules) {
    const qualifies = rule.test(metrics, ctx);
    if (!qualifies) continue;
    awardedNow.add(rule.id);
    if (!alreadyAwarded.has(rule.id)) {
      newlyAwarded.push({ id: rule.id, title: rule.title, description: rule.description });
    }
  }

  return { awardedNow, newlyAwarded };
}
