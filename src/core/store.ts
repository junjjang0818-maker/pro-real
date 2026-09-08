import type { Clock } from './time/clock';
import { localDateOf, type LocalDate } from './time/dayAttribution';
import { reduce, type Command, type CommandError } from './session/reducer';
import { isPaused } from './session/elapsed';
import {
  recoverActiveSession,
  resolveRecovery,
  DEFAULT_RECOVERY_POLICY,
  type RecoveryOutcome,
  type RecoveryPolicy,
} from './session/recovery';
import type {
  ActiveSessionSnapshot,
  Session,
  SessionEvent,
} from './session/types';
import type { Subject } from './subjects';
import {
  computeDailyAttendance,
  type DailyAttendance,
} from './derivations/attendance';
import { computeStreak, type StreakResult, type FreezeConfig } from './derivations/streak';
import { computeSubjectStats, type SubjectStat } from './derivations/subjectStats';
import { evaluateBadges, type EvaluateBadgesResult } from './derivations/badges';

/**
 * The single source of truth. Every input path (button / gesture / voice) calls
 * `dispatch`. `sessions` + `events` are the ONLY writable state; attendance,
 * streak, subject stats and badges are computed on read from that same list, so
 * they can never disagree with the timer.
 *
 * Persistence is a port: SQLite for the session log + MMKV for the crash-recovery
 * snapshot in the app; in-memory in tests.
 */

export interface Persistence {
  loadSessions(): Session[];
  appendSession(session: Session): void;
  updateSession(session: Session): void;
  appendEvents(events: SessionEvent[]): void;
  loadSnapshot(): ActiveSessionSnapshot | null;
  writeSnapshot(snapshot: ActiveSessionSnapshot | null): void;
  loadAwardedBadges(): string[];
  writeAwardedBadges(ids: string[]): void;
}

export interface StoreConfig {
  dailyGoalMs: number;
  freezeConfig?: FreezeConfig;
  recoveryPolicy?: RecoveryPolicy;
  heartbeatMs?: number;
}

export interface DispatchResult {
  ok: boolean;
  error?: CommandError;
  active: Session | null;
  completed: Session | null;
  badges: EvaluateBadgesResult;
}

let eventSeq = 0;

export class SessionStore {
  private sessions: Session[];
  private active: Session | null = null;
  private awarded: Set<string>;
  private listeners = new Set<() => void>();

  constructor(
    private readonly clock: Clock,
    private readonly persist: Persistence,
    private readonly config: StoreConfig,
    private newId: () => string = defaultId,
  ) {
    this.sessions = persist.loadSessions();
    this.awarded = new Set(persist.loadAwardedBadges());
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const l of [...this.listeners]) l();
  }

  // ── cold-start recovery ────────────────────────────────────────────────
  inspectRecovery(): RecoveryOutcome {
    return recoverActiveSession(
      this.persist.loadSnapshot(),
      this.clock.now(),
      this.config.recoveryPolicy ?? DEFAULT_RECOVERY_POLICY,
    );
  }

  applyRecovery(outcome: RecoveryOutcome, decision?: Parameters<typeof resolveRecovery>[1]): void {
    if (outcome.kind === 'none') return;
    if (outcome.kind === 'resumed') {
      this.active = outcome.session;
      this.writeSnapshot();
      this.emit();
      return;
    }
    if (outcome.kind === 'auto-finalized') {
      this.commitCompleted(outcome.session);
      this.persist.writeSnapshot(null);
      this.emit();
      return;
    }
    // needs-confirmation
    const d = decision ?? { kind: 'finalize-at-heartbeat' as const, heartbeat: this.persist.loadSnapshot()!.lastHeartbeat };
    const { active, completed } = resolveRecovery(outcome.session, d, this.clock.now());
    this.active = active;
    if (completed) this.commitCompleted(completed);
    this.persist.writeSnapshot(active ? this.snapshotOf(active) : null);
    this.emit();
  }

  // ── the one write path ────────────────────────────────────────────────
  dispatch(command: Command): DispatchResult {
    const now = this.clock.now();
    const result = reduce(this.active, command, now);

    if (result.error) {
      return {
        ok: false,
        error: result.error,
        active: this.active,
        completed: null,
        badges: { awardedNow: new Set(this.awarded), newlyAwarded: [] },
      };
    }

    const events: SessionEvent[] = result.events.map((e) => ({ ...e, id: ++eventSeq }));
    if (events.length) this.persist.appendEvents(events);

    if (result.completed) {
      this.commitCompleted(result.completed);
      this.active = null;
      this.persist.writeSnapshot(null);
    } else if (result.active) {
      const existed = this.active != null;
      this.active = result.active;
      if (!existed) {
        // brand new session row
        this.sessions = [...this.sessions, result.active];
        this.persist.appendSession(result.active);
      }
      this.writeSnapshot();
    }

    const badges = this.evaluateBadges(now);
    this.emit();
    return {
      ok: true,
      active: this.active,
      completed: result.completed,
      badges,
    };
  }

  /** periodic heartbeat — refreshes the crash-recovery snapshot only. */
  heartbeat(): void {
    if (!this.active) return;
    this.writeSnapshot();
  }

  // ── derivations (computed on read from `allSessions()`) ───────────────
  private allSessions(): Session[] {
    // active session is already inside `this.sessions` once created
    return this.sessions;
  }

  getActive(): Session | null {
    return this.active;
  }
  isActivePaused(): boolean {
    return this.active ? isPaused(this.active) : false;
  }

  today(): LocalDate {
    const n = this.clock.now();
    return localDateOf(n.wall, n.tzOffsetMin);
  }

  attendance(): DailyAttendance[] {
    return computeDailyAttendance({
      sessions: this.allSessions(),
      defaultGoalMs: this.config.dailyGoalMs,
      now: this.clock.now(),
    });
  }

  streak(): StreakResult {
    return computeStreak({
      attendance: this.attendance(),
      today: this.today(),
      freezeConfig: this.config.freezeConfig,
    });
  }

  subjectStats(subjects: Subject[], windowDays: 7 | 30 = 7): SubjectStat[] {
    return computeSubjectStats({
      sessions: this.allSessions(),
      subjects,
      today: this.today(),
      windowDays,
      now: this.clock.now(),
    });
  }

  awardedBadges(): Set<string> {
    return new Set(this.awarded);
  }

  private evaluateBadges(_now = this.clock.now()): EvaluateBadgesResult {
    const res = evaluateBadges(
      { sessions: this.allSessions(), attendance: this.attendance(), streak: this.streak() },
      this.awarded,
    );
    if (res.newlyAwarded.length) {
      this.awarded = res.awardedNow;
      this.persist.writeAwardedBadges([...this.awarded]);
    }
    return res;
  }

  // ── internals ────────────────────────────────────────────────────────
  private commitCompleted(session: Session): void {
    const idx = this.sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
      this.sessions = this.sessions.map((s) => (s.id === session.id ? session : s));
      this.persist.updateSession(session);
    } else {
      this.sessions = [...this.sessions, session];
      this.persist.appendSession(session);
    }
  }

  private snapshotOf(session: Session): ActiveSessionSnapshot {
    return { session, lastHeartbeat: this.clock.now(), snapshotVersion: Date.now() };
  }

  private writeSnapshot(): void {
    this.persist.writeSnapshot(this.active ? this.snapshotOf(this.active) : null);
  }
}

function defaultId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Simple in-memory Persistence — used in tests and as the shape SQLite/MMKV implement. */
export function inMemoryPersistence(seed?: Partial<Persistence>): Persistence {
  let sessions: Session[] = [];
  let events: SessionEvent[] = [];
  let snapshot: ActiveSessionSnapshot | null = null;
  let awarded: string[] = [];
  return {
    loadSessions: () => [...sessions],
    appendSession: (s) => {
      sessions = [...sessions, s];
    },
    updateSession: (s) => {
      sessions = sessions.map((x) => (x.id === s.id ? s : x));
    },
    appendEvents: (e) => {
      events = [...events, ...e];
    },
    loadSnapshot: () => snapshot,
    writeSnapshot: (s) => {
      snapshot = s;
    },
    loadAwardedBadges: () => [...awarded],
    writeAwardedBadges: (ids) => {
      awarded = [...ids];
    },
    ...seed,
  };
}
