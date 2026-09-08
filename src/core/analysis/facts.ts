import type { ClockStamp } from '../time/clock';
import { diffLocalDays, type LocalDate } from '../time/dayAttribution';
import type { Session } from '../session/types';
import type { Subject } from '../subjects';
import type { StreakResult } from '../derivations/streak';
import { computeSubjectStats } from '../derivations/subjectStats';

/**
 * `AnalysisFacts` is the ONLY payload that leaves the device for AI comment
 * generation. Everything here is aggregate / rounded — no raw session
 * timestamps, no identifiers, never camera data. Keep this type and
 * `buildAnalysisFacts` in sync with docs/privacy-policy-draft.md.
 */

export interface AnalysisFactsSubject {
  label: string; // user-provided string
  targetMinutes: number;
  actualMinutes: number; // day-bucketed sum, rounded to the minute
  lastSessionDaysAgo: number | null;
  missedDayCount: number;
}

export interface AnalysisFacts {
  status: 'ready';
  generatedAtWall: number;
  windowDays: number;
  locale: string;
  anonymousInstallId: string; // random UUID, NOT a device id
  dailyGoalMinutes: number;
  streakCurrent: number;
  subjects: AnalysisFactsSubject[];
}

export type InsufficientReason = 'too-new' | 'not-enough-days' | 'not-enough-sessions';

export interface InsufficientData {
  status: 'collecting';
  reason: InsufficientReason;
  progress: { distinctStudyDays: number; totalSessions: number; daysSinceInstall: number };
  needed: { distinctStudyDays: number; totalSessions: number; daysSinceInstall: number };
}

export const DATA_REQUIREMENTS = {
  distinctStudyDays: 3,
  totalSessions: 5,
  daysSinceInstall: 3,
} as const;

export interface BuildFactsParams {
  sessions: Session[];
  subjects: Subject[];
  streak: StreakResult;
  installDate: LocalDate;
  today: LocalDate;
  windowDays: number;
  dailyGoalMs: number;
  locale: string;
  anonymousInstallId: string;
  now?: ClockStamp;
}

const REAL_STATUSES: ReadonlyArray<Session['status']> = ['completed', 'recovered'];

export function buildAnalysisFacts(params: BuildFactsParams): AnalysisFacts | InsufficientData {
  const real = params.sessions.filter((s) => REAL_STATUSES.includes(s.status));
  const distinctStudyDays = new Set(real.map((s) => s.attributedLocalDate)).size;
  const totalSessions = real.length;
  const daysSinceInstall = Math.max(0, diffLocalDays(params.today, params.installDate));

  const progress = { distinctStudyDays, totalSessions, daysSinceInstall };
  const needed = { ...DATA_REQUIREMENTS };

  // 데이터 부족 가드 — priority: too-new -> not-enough-days -> not-enough-sessions
  if (daysSinceInstall < DATA_REQUIREMENTS.daysSinceInstall) {
    return { status: 'collecting', reason: 'too-new', progress, needed };
  }
  if (distinctStudyDays < DATA_REQUIREMENTS.distinctStudyDays) {
    return { status: 'collecting', reason: 'not-enough-days', progress, needed };
  }
  if (totalSessions < DATA_REQUIREMENTS.totalSessions) {
    return { status: 'collecting', reason: 'not-enough-sessions', progress, needed };
  }

  const stats = computeSubjectStats({
    sessions: params.sessions,
    subjects: params.subjects,
    today: params.today,
    windowDays: params.windowDays,
    now: params.now,
    countStatuses: REAL_STATUSES,
  });

  return {
    status: 'ready',
    generatedAtWall: params.now?.wall ?? Date.now(),
    windowDays: params.windowDays,
    locale: params.locale,
    anonymousInstallId: params.anonymousInstallId,
    dailyGoalMinutes: Math.round(params.dailyGoalMs / 60_000),
    streakCurrent: params.streak.current,
    subjects: stats.map((s) => ({
      label: s.label,
      targetMinutes: Math.round(s.targetMs / 60_000),
      actualMinutes: Math.round(s.actualMs / 60_000),
      lastSessionDaysAgo: s.daysSinceLastSession,
      missedDayCount: s.consecutiveDaysMissed,
    })),
  };
}

export function isInsufficient(x: AnalysisFacts | InsufficientData): x is InsufficientData {
  return x.status === 'collecting';
}
