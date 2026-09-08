import type { ClockStamp } from '../time/clock';
import { addLocalDays, diffLocalDays, type LocalDate } from '../time/dayAttribution';
import { computeElapsed } from '../session/elapsed';
import type { Session } from '../session/types';
import type { Subject } from '../subjects';

/**
 * Per-subject goal-vs-actual — the RULE-BASED part of "AI 학습 분석". No model,
 * just arithmetic over the session list. The natural-language comment layer
 * (analysis/) consumes these numbers.
 */

export interface SubjectStat {
  subjectId: string;
  label: string;
  windowDays: number;
  targetMs: number; // weekly target scaled to the window
  actualMs: number;
  deficitMs: number; // max(0, target - actual)
  deficitPct: number; // 0..1, 0 if target is 0
  lastSessionDate: LocalDate | null;
  daysSinceLastSession: number | null;
  consecutiveDaysMissed: number; // trailing days from `today` with no session
  sessionCount: number;
}

export interface SubjectStatsParams {
  sessions: Session[];
  subjects: Subject[];
  today: LocalDate;
  windowDays: number; // e.g. 7 or 30
  now?: ClockStamp; // include a running session's partial time
  countStatuses?: ReadonlyArray<Session['status']>;
}

const DEFAULT_COUNT_STATUSES: ReadonlyArray<Session['status']> = [
  'completed',
  'recovered',
  'running',
];

export function computeSubjectStats(params: SubjectStatsParams): SubjectStat[] {
  const { sessions, subjects, today, windowDays, now } = params;
  const countStatuses = params.countStatuses ?? DEFAULT_COUNT_STATUSES;
  const windowStart = addLocalDays(today, -(windowDays - 1));

  return subjects.map((subject) => {
    const subjectSessions = sessions.filter(
      (s) => s.subjectId === subject.id && countStatuses.includes(s.status),
    );

    let actualMs = 0;
    let lastSessionDate: LocalDate | null = null;
    const daysWithSession = new Set<LocalDate>();

    for (const s of subjectSessions) {
      if (s.status === 'running' && !now) continue;
      const date = s.attributedLocalDate;
      if (lastSessionDate == null || date > lastSessionDate) lastSessionDate = date;

      if (date < windowStart || date > today) continue;
      const asOf: ClockStamp = s.endWall != null ? s.start : (now as ClockStamp);
      const { countedMs } = computeElapsed(
        { start: s.start, pauses: s.pauses, endWall: s.endWall },
        asOf,
      );
      actualMs += countedMs;
      daysWithSession.add(date);
    }

    const targetMs = Math.round((subject.weeklyTargetMs * windowDays) / 7);
    const deficitMs = Math.max(0, targetMs - actualMs);
    const deficitPct = targetMs > 0 ? deficitMs / targetMs : 0;

    const daysSinceLastSession =
      lastSessionDate != null ? diffLocalDays(today, lastSessionDate) : null;

    let consecutiveDaysMissed = 0;
    for (let d = 0; d < windowDays; d++) {
      const date = addLocalDays(today, -d);
      if (daysWithSession.has(date)) break;
      consecutiveDaysMissed += 1;
    }

    return {
      subjectId: subject.id,
      label: subject.label,
      windowDays,
      targetMs,
      actualMs,
      deficitMs,
      deficitPct,
      lastSessionDate,
      daysSinceLastSession,
      consecutiveDaysMissed,
      sessionCount: subjectSessions.length,
    };
  });
}

/** Subjects sorted by how far behind target they are (worst first). */
export function rankByDeficit(stats: SubjectStat[]): SubjectStat[] {
  return [...stats].sort((a, b) => b.deficitPct - a.deficitPct || b.deficitMs - a.deficitMs);
}
