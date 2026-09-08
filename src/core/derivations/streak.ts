import {
  addLocalDays,
  compareLocalDate,
  diffLocalDays,
  type LocalDate,
} from '../time/dayAttribution';
import type { DailyAttendance } from './attendance';

/**
 * Streak calculation — derived from attendance, which is derived from sessions.
 *
 * Design decisions (docs/02-architecture.md §2.3):
 *  - The walk is over LOCAL DATE STRINGS that were recorded at session time.
 *    Timezone travel therefore cannot silently corrupt a streak: a day that
 *    never existed locally is simply absent (treated as a normal miss); a
 *    duplicated date collapses to one string.
 *  - "Freezes" bridge single missed days. You earn one every
 *    `earnEveryNAttendedDays` attended days, capped at `maxFreezes`. A miss the
 *    walk can't bridge ends the current streak.
 *  - `current` counts consecutive attended days ending today. If today isn't
 *    attended yet, the streak is reported as of *yesterday* and
 *    `todayAttended` is false (UI shows "study today to keep your N-day streak").
 *  - `longest` is the longest run of PURE consecutive attended days (no
 *    freezes applied), scanned over all history.
 */

export interface FreezeConfig {
  earnEveryNAttendedDays: number;
  maxFreezes: number;
}

export const DEFAULT_FREEZE_CONFIG: FreezeConfig = {
  earnEveryNAttendedDays: 7,
  maxFreezes: 2,
};

export interface StreakInput {
  attendance: DailyAttendance[];
  today: LocalDate;
  freezeConfig?: FreezeConfig;
}

export interface StreakResult {
  current: number;
  longest: number;
  todayAttended: boolean;
  lastAttendedDate: LocalDate | null;
  freezesEarned: number;
  freezesUsed: number;
  freezesRemaining: number;
  usedFreezeDates: LocalDate[];
}

export function computeStreak(input: StreakInput): StreakResult {
  const cfg = input.freezeConfig ?? DEFAULT_FREEZE_CONFIG;
  const attended = new Set(
    input.attendance.filter((a) => a.attended).map((a) => a.localDate),
  );

  const totalAttended = attended.size;
  const freezesEarned = Math.min(
    cfg.maxFreezes,
    Math.floor(totalAttended / Math.max(1, cfg.earnEveryNAttendedDays)),
  );

  const sortedDates = [...attended].sort(compareLocalDate);
  const lastAttendedDate = sortedDates.length ? sortedDates[sortedDates.length - 1]! : null;
  const todayAttended = attended.has(input.today);

  // Walk backwards from today (or yesterday if today not done yet).
  let cursor = todayAttended ? input.today : addLocalDays(input.today, -1);
  let current = 0;
  let freezesUsed = 0;
  const usedFreezeDates: LocalDate[] = [];

  // If neither today nor yesterday attended, current streak is 0.
  while (true) {
    if (attended.has(cursor)) {
      current += 1;
      cursor = addLocalDays(cursor, -1);
      continue;
    }
    // gap day: try to spend a freeze to bridge exactly this one day,
    // but only if there is an attended day further back to continue onto.
    if (freezesUsed < freezesEarned && attended.has(addLocalDays(cursor, -1))) {
      freezesUsed += 1;
      usedFreezeDates.push(cursor);
      cursor = addLocalDays(cursor, -1);
      continue;
    }
    break;
  }

  return {
    current,
    longest: longestPureRun(sortedDates),
    todayAttended,
    lastAttendedDate,
    freezesEarned,
    freezesUsed,
    freezesRemaining: Math.max(0, freezesEarned - freezesUsed),
    usedFreezeDates,
  };
}

function longestPureRun(sortedDates: LocalDate[]): number {
  if (sortedDates.length === 0) return 0;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    if (diffLocalDays(sortedDates[i]!, sortedDates[i - 1]!) === 1) {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return longest;
}
