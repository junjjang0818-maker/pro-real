import type { ClockStamp } from '../time/clock';
import { localDateOf, type LocalDate } from '../time/dayAttribution';
import { computeElapsed } from '../session/elapsed';
import type { Session } from '../session/types';

/**
 * Attendance is a PURE DERIVATION of the session list. Nothing writes it.
 *
 * Rules (docs/02-architecture.md §2.3):
 *  - a session's time counts toward `session.attributedLocalDate`
 *    (frozen from the start-time timezone offset)
 *  - a session that crossed local midnight still counts entirely toward its
 *    start date
 *  - a day is "attended" once counted time >= that day's goal
 *  - a currently-running session is included live when `now` is supplied, so
 *    "timer running but attendance not recorded" cannot happen
 */

export interface DailyAttendance {
  localDate: LocalDate;
  countedMs: number;
  goalMs: number;
  attended: boolean;
  sessionIds: string[];
  crossedMidnight: boolean;
}

export interface AttendanceParams {
  sessions: Session[];
  defaultGoalMs: number;
  /** optional per-date goal override (goal changed over time). */
  goalMsForDate?: (d: LocalDate) => number | undefined;
  /** include the running session's partial time as of this instant. */
  now?: ClockStamp;
  /** only count sessions with one of these statuses (default: all "real" ones). */
  countStatuses?: ReadonlyArray<Session['status']>;
}

const DEFAULT_COUNT_STATUSES: ReadonlyArray<Session['status']> = [
  'completed',
  'recovered',
  'running',
];

export function computeDailyAttendance(params: AttendanceParams): DailyAttendance[] {
  const { sessions, defaultGoalMs, goalMsForDate, now } = params;
  const countStatuses = params.countStatuses ?? DEFAULT_COUNT_STATUSES;

  const byDate = new Map<
    LocalDate,
    { countedMs: number; sessionIds: string[]; crossedMidnight: boolean }
  >();

  for (const s of sessions) {
    if (!countStatuses.includes(s.status)) continue;
    if (s.status === 'running' && !now) continue;

    const date =
      s.attributedLocalDate || localDateOf(s.start.wall, s.start.tzOffsetMin);
    // completed sessions ignore `asOf` (they trust endWall); running ones need `now`.
    const asOf: ClockStamp = s.endWall != null ? s.start : (now as ClockStamp);
    const { countedMs } = computeElapsed(
      { start: s.start, pauses: s.pauses, endWall: s.endWall },
      asOf,
    );
    if (countedMs <= 0) continue;

    const endWall = s.endWall ?? now!.wall;
    const crossed =
      localDateOf(s.start.wall, s.start.tzOffsetMin) !==
      localDateOf(endWall, s.start.tzOffsetMin);

    const bucket = byDate.get(date) ?? {
      countedMs: 0,
      sessionIds: [],
      crossedMidnight: false,
    };
    bucket.countedMs += countedMs;
    bucket.sessionIds.push(s.id);
    bucket.crossedMidnight = bucket.crossedMidnight || crossed;
    byDate.set(date, bucket);
  }

  const out: DailyAttendance[] = [];
  for (const [localDate, b] of byDate) {
    const goalMs = goalMsForDate?.(localDate) ?? defaultGoalMs;
    out.push({
      localDate,
      countedMs: b.countedMs,
      goalMs,
      attended: b.countedMs >= goalMs,
      sessionIds: b.sessionIds,
      crossedMidnight: b.crossedMidnight,
    });
  }
  out.sort((a, b) => (a.localDate < b.localDate ? -1 : a.localDate > b.localDate ? 1 : 0));
  return out;
}

/** Set of attended date strings — convenience for streak math and heatmaps. */
export function attendedDateSet(attendance: DailyAttendance[]): Set<LocalDate> {
  return new Set(attendance.filter((a) => a.attended).map((a) => a.localDate));
}
