import type { ClockStamp } from '../time/clock';
import { localDateOf } from '../time/dayAttribution';
import { detectBoundaryAnomaly, isPaused } from './elapsed';
import {
  SCHEMA_VERSION,
  type FocusRating,
  type InputSource,
  type Session,
  type SessionEvent,
  type SessionEventType,
} from './types';

/**
 * The ONE write path. Buttons, gestures and voice all build a `Command` and
 * call `reduce`. There is no other way to create, mutate or finalize a Session,
 * which is what guarantees session / attendance / stats can never diverge.
 *
 * `reduce` is pure: (activeSession, command, now) -> { active, completed, events, error }.
 * The caller (store) persists `completed` to SQLite, appends `events` to the log
 * and writes the MMKV snapshot. `reduce` itself touches no I/O.
 */

export type Command =
  | {
      type: 'START';
      sessionId: string;
      subjectId: string | null;
      plannedMs: number | null;
      source: InputSource;
    }
  | { type: 'PAUSE'; source: InputSource }
  | { type: 'RESUME'; source: InputSource }
  | { type: 'STOP'; source: InputSource; focusSelfRating?: FocusRating | null }
  | { type: 'ABANDON'; reason: string; source: InputSource }
  | { type: 'TAG_SUBJECT'; subjectId: string; source: InputSource }
  | { type: 'SET_RATING'; rating: FocusRating; source: InputSource }
  | { type: 'MARK_SCREEN_TOUCHED' };

export type CommandError =
  | 'ALREADY_RUNNING'
  | 'NO_ACTIVE_SESSION'
  | 'ALREADY_PAUSED'
  | 'NOT_PAUSED'
  | 'INVALID_RATING';

export interface ReduceResult {
  active: Session | null;
  completed: Session | null; // set by STOP / ABANDON
  events: Omit<SessionEvent, 'id'>[]; // store assigns monotonic ids
  error?: CommandError;
}

function ev(
  type: SessionEventType,
  sessionId: string,
  at: ClockStamp,
  payload: Record<string, unknown> = {},
): Omit<SessionEvent, 'id'> {
  return { type, sessionId, at, payload };
}

function reject(active: Session | null, error: CommandError): ReduceResult {
  return { active, completed: null, events: [], error };
}

export function reduce(
  active: Session | null,
  cmd: Command,
  now: ClockStamp,
): ReduceResult {
  switch (cmd.type) {
    case 'START': {
      if (active) return reject(active, 'ALREADY_RUNNING');
      const session: Session = {
        id: cmd.sessionId,
        ownerId: 'local',
        subjectId: cmd.subjectId,
        status: 'running',
        start: now,
        endWall: null,
        plannedMs: cmd.plannedMs,
        pauses: [],
        focusSelfRating: null,
        startSource: cmd.source,
        endSource: null,
        screenTouchedDuringSession: cmd.source === 'button' || cmd.source === 'voice',
        clockAnomaly: false,
        attributedLocalDate: localDateOf(now.wall, now.tzOffsetMin),
        schemaVersion: SCHEMA_VERSION,
        createdAt: now.wall,
        updatedAt: now.wall,
      };
      return {
        active: session,
        completed: null,
        events: [
          ev('SESSION_STARTED', session.id, now, {
            subjectId: cmd.subjectId,
            plannedMs: cmd.plannedMs,
            source: cmd.source,
          }),
        ],
      };
    }

    case 'PAUSE': {
      if (!active) return reject(null, 'NO_ACTIVE_SESSION');
      if (isPaused(active)) return reject(active, 'ALREADY_PAUSED');
      const next: Session = {
        ...active,
        pauses: [...active.pauses, { pausedAt: now.wall, resumedAt: null }],
        updatedAt: now.wall,
      };
      return {
        active: next,
        completed: null,
        events: [ev('SESSION_PAUSED', next.id, now, { source: cmd.source })],
      };
    }

    case 'RESUME': {
      if (!active) return reject(null, 'NO_ACTIVE_SESSION');
      if (!isPaused(active)) return reject(active, 'NOT_PAUSED');
      const pauses = active.pauses.slice();
      pauses[pauses.length - 1] = { ...pauses[pauses.length - 1]!, resumedAt: now.wall };
      const next: Session = { ...active, pauses, updatedAt: now.wall };
      return {
        active: next,
        completed: null,
        events: [ev('SESSION_RESUMED', next.id, now, { source: cmd.source })],
      };
    }

    case 'STOP': {
      if (!active) return reject(null, 'NO_ACTIVE_SESSION');
      if (cmd.focusSelfRating != null && !isValidRating(cmd.focusSelfRating)) {
        return reject(active, 'INVALID_RATING');
      }
      const closedPauses = closeOpenPause(active.pauses, now.wall);
      const clockAnomaly = detectBoundaryAnomaly(active.start, now);
      const completed: Session = {
        ...active,
        status: 'completed',
        endWall: now.wall,
        endSource: cmd.source,
        pauses: closedPauses,
        focusSelfRating: cmd.focusSelfRating ?? active.focusSelfRating,
        clockAnomaly: active.clockAnomaly || clockAnomaly,
        updatedAt: now.wall,
      };
      const events: Omit<SessionEvent, 'id'>[] = [
        ev('SESSION_STOPPED', completed.id, now, { source: cmd.source }),
      ];
      if (cmd.focusSelfRating != null) {
        events.push(ev('SELF_RATING_SET', completed.id, now, { rating: cmd.focusSelfRating }));
      }
      return { active: null, completed, events };
    }

    case 'ABANDON': {
      if (!active) return reject(null, 'NO_ACTIVE_SESSION');
      const closedPauses = closeOpenPause(active.pauses, now.wall);
      const completed: Session = {
        ...active,
        status: 'abandoned',
        endWall: now.wall,
        endSource: cmd.source,
        pauses: closedPauses,
        updatedAt: now.wall,
      };
      return {
        active: null,
        completed,
        events: [ev('SESSION_ABANDONED', completed.id, now, { reason: cmd.reason, source: cmd.source })],
      };
    }

    case 'TAG_SUBJECT': {
      if (!active) return reject(null, 'NO_ACTIVE_SESSION');
      const next: Session = { ...active, subjectId: cmd.subjectId, updatedAt: now.wall };
      return {
        active: next,
        completed: null,
        events: [ev('SUBJECT_TAGGED', next.id, now, { subjectId: cmd.subjectId, source: cmd.source })],
      };
    }

    case 'SET_RATING': {
      if (!active) return reject(null, 'NO_ACTIVE_SESSION');
      if (!isValidRating(cmd.rating)) return reject(active, 'INVALID_RATING');
      const next: Session = { ...active, focusSelfRating: cmd.rating, updatedAt: now.wall };
      return {
        active: next,
        completed: null,
        events: [ev('SELF_RATING_SET', next.id, now, { rating: cmd.rating, source: cmd.source })],
      };
    }

    case 'MARK_SCREEN_TOUCHED': {
      if (!active) return reject(null, 'NO_ACTIVE_SESSION');
      if (active.screenTouchedDuringSession) return { active, completed: null, events: [] };
      const next: Session = { ...active, screenTouchedDuringSession: true, updatedAt: now.wall };
      return {
        active: next,
        completed: null,
        events: [ev('SCREEN_TOUCHED', next.id, now, {})],
      };
    }

    default: {
      const _exhaustive: never = cmd;
      return reject(active, 'NO_ACTIVE_SESSION');
    }
  }
}

function isValidRating(r: number): r is FocusRating {
  return Number.isInteger(r) && r >= 1 && r <= 5;
}

function closeOpenPause(pauses: Session['pauses'], atWall: number): Session['pauses'] {
  if (pauses.length === 0) return pauses;
  const last = pauses[pauses.length - 1]!;
  if (last.resumedAt != null) return pauses;
  const copy = pauses.slice();
  copy[copy.length - 1] = { ...last, resumedAt: atWall };
  return copy;
}
