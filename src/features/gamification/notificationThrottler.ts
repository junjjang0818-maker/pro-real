/**
 * NotificationThrottler — keeps celebratory pushes from becoming fatigue.
 *
 * Rules (docs/06-gamification.md):
 *   - at most `maxPerDay` celebratory notifications per local day
 *   - at least `minGapMs` between two celebratory notifications
 *   - notifications requested close together are BATCHED into one
 *   - quiet hours: defer (not drop) until the window opens
 *
 * Pure/deterministic: you pass the current time and the recent history in, it
 * tells you whether to send now, batch, or defer. The store owns persistence of
 * `history`.
 */

import { localDateOf, localMinutesOfDay } from '../../core/time/dayAttribution';

export interface ThrottlerConfig {
  maxPerDay: number;
  minGapMs: number;
  batchWindowMs: number;
  quietHours: { startMinute: number; endMinute: number } | null; // local minutes-of-day
}

export const DEFAULT_THROTTLER_CONFIG: ThrottlerConfig = {
  maxPerDay: 2,
  minGapMs: 3 * 60 * 60 * 1000,
  batchWindowMs: 90 * 1000,
  quietHours: { startMinute: 22 * 60, endMinute: 8 * 60 }, // 22:00–08:00
};

export interface SentRecord {
  atWall: number;
  count: number; // how many badge items were represented
}

export interface ThrottleRequest {
  nowWall: number;
  tzOffsetMin: number;
  pendingBadgeIds: string[]; // newly-awarded badges wanting a notification
  history: SentRecord[]; // prior celebratory sends (any order)
}

export type ThrottleDecision =
  | { action: 'send'; badgeIds: string[]; title: string }
  | { action: 'batch-into-recent'; badgeIds: string[] } // merge into the just-sent one
  | { action: 'defer'; badgeIds: string[]; reason: 'min-gap' | 'daily-cap' | 'quiet-hours'; retryAtWall: number };

export function decideNotification(req: ThrottleRequest, cfg: ThrottlerConfig = DEFAULT_THROTTLER_CONFIG): ThrottleDecision {
  const badgeIds = [...new Set(req.pendingBadgeIds)];
  if (badgeIds.length === 0) {
    return { action: 'defer', badgeIds, reason: 'min-gap', retryAtWall: req.nowWall };
  }

  const today = localDateOf(req.nowWall, req.tzOffsetMin);
  const sentToday = req.history.filter((h) => localDateOf(h.atWall, req.tzOffsetMin) === today);
  const last = req.history.reduce<SentRecord | null>((a, b) => (a && a.atWall >= b.atWall ? a : b), null);

  // batch: something was sent very recently -> fold these into it, no new push
  if (last && req.nowWall - last.atWall <= cfg.batchWindowMs) {
    return { action: 'batch-into-recent', badgeIds };
  }

  // quiet hours -> defer to window open
  if (cfg.quietHours && inQuietHours(localMinutesOfDay(req.nowWall, req.tzOffsetMin), cfg.quietHours)) {
    return {
      action: 'defer',
      badgeIds,
      reason: 'quiet-hours',
      retryAtWall: nextQuietHoursEnd(req.nowWall, req.tzOffsetMin, cfg.quietHours),
    };
  }

  // daily cap
  if (sentToday.length >= cfg.maxPerDay) {
    return { action: 'defer', badgeIds, reason: 'daily-cap', retryAtWall: startOfNextLocalDay(req.nowWall, req.tzOffsetMin) };
  }

  // min gap between sends
  if (last && req.nowWall - last.atWall < cfg.minGapMs) {
    return { action: 'defer', badgeIds, reason: 'min-gap', retryAtWall: last.atWall + cfg.minGapMs };
  }

  return { action: 'send', badgeIds, title: titleFor(badgeIds.length) };
}

function titleFor(n: number): string {
  return n === 1 ? '뱃지를 획득했어요!' : `뱃지 ${n}개를 획득했어요!`;
}

function inQuietHours(minute: number, q: { startMinute: number; endMinute: number }): boolean {
  if (q.startMinute === q.endMinute) return false;
  if (q.startMinute < q.endMinute) return minute >= q.startMinute && minute < q.endMinute;
  // wraps midnight
  return minute >= q.startMinute || minute < q.endMinute;
}

function startOfNextLocalDay(nowWall: number, tzOffsetMin: number): number {
  const minute = localMinutesOfDay(nowWall, tzOffsetMin);
  return nowWall + (24 * 60 - minute) * 60_000;
}

function nextQuietHoursEnd(nowWall: number, tzOffsetMin: number, q: { startMinute: number; endMinute: number }): number {
  const minute = localMinutesOfDay(nowWall, tzOffsetMin);
  let delta = q.endMinute - minute;
  if (delta <= 0) delta += 24 * 60;
  return nowWall + delta * 60_000;
}
