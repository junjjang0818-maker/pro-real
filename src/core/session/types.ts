import type { ClockStamp } from '../time/clock';
import type { LocalDate } from '../time/dayAttribution';

/** Where an action came from. Buttons, gestures and voice all end up here. */
export type InputSource = 'gesture' | 'button' | 'voice' | 'system';

export type SessionStatus =
  | 'running'
  | 'completed'
  | 'abandoned'
  | 'recovered'; // finalized by crash-recovery rather than an explicit STOP

export type FocusRating = 1 | 2 | 3 | 4 | 5;

export interface PauseInterval {
  pausedAt: number; // wall ms
  resumedAt: number | null; // null => still paused (or session ended while paused)
}

/**
 * The SINGLE writable record. Attendance, streaks, subject stats, badges and AI
 * inputs are ALL pure derivations of a list of these — nothing writes them
 * directly. This is what makes "timer running but attendance not recorded"
 * structurally impossible.
 */
export interface Session {
  id: string;
  ownerId: string; // 'local' for now; reserved for future group sharing
  subjectId: string | null; // may be tagged at start or corrected at stop
  status: SessionStatus;

  start: ClockStamp;
  endWall: number | null;

  plannedMs: number | null; // pomodoro-style target; null = open-ended
  pauses: PauseInterval[];

  focusSelfRating: FocusRating | null; // set at stop (finger count 1..5)

  startSource: InputSource;
  endSource: InputSource | null;

  /** true if the user touched the screen at any point while running. */
  screenTouchedDuringSession: boolean;

  /** set when wall/monotonic disagreed — elapsed was taken from monotonic. */
  clockAnomaly: boolean;

  /** local date this session counts toward — frozen from start.tzOffsetMin. */
  attributedLocalDate: LocalDate;

  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
}

export type SessionEventType =
  | 'SESSION_STARTED'
  | 'SESSION_PAUSED'
  | 'SESSION_RESUMED'
  | 'SESSION_STOPPED'
  | 'SESSION_ABANDONED'
  | 'SESSION_RECOVERED'
  | 'SUBJECT_TAGGED'
  | 'SELF_RATING_SET'
  | 'SCREEN_TOUCHED';

/** Append-only transition log. Feeds AI/analytics, crash-recovery audit, and
 *  (later) multi-device sync / group sharing. Never mutated. */
export interface SessionEvent {
  id: number; // monotonically increasing, assigned by the store
  sessionId: string;
  type: SessionEventType;
  at: ClockStamp;
  payload: Record<string, unknown>;
}

/** Denormalized snapshot persisted synchronously (MMKV) on every transition
 *  and on a heartbeat, so an OS process kill can be recovered from. */
export interface ActiveSessionSnapshot {
  session: Session;
  lastHeartbeat: ClockStamp;
  snapshotVersion: number;
}

export const SCHEMA_VERSION = 1;
