import type { ClockStamp } from '../time/clock';
import { computeElapsed } from './elapsed';
import type { ActiveSessionSnapshot, Session } from './types';

/**
 * Cold-start reconciliation — handles iOS killing the app process under memory
 * pressure (and Android task-swipe / low-memory kill).
 *
 * On every transition and on a heartbeat (~15s) the store writes an
 * `ActiveSessionSnapshot` to MMKV synchronously. On next launch we read it and
 * decide what to do based on how stale the last heartbeat is:
 *
 *   heartbeat age <= freshWithinMs      -> resume as-is, keep timing from start
 *   freshWithinMs < age < autoFinalize  -> ask the user (keep / adjust / discard)
 *   age >= autoFinalizeAfterMs          -> finalize silently at lastHeartbeat
 *
 * We never invent time the user didn't study: the conservative end is always
 * `lastHeartbeat.wall`, not "now".
 */

export interface RecoveryPolicy {
  freshWithinMs: number; // e.g. 90_000
  autoFinalizeAfterMs: number; // e.g. 12h
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = {
  freshWithinMs: 90_000,
  autoFinalizeAfterMs: 12 * 60 * 60 * 1000,
};

export type RecoveryOutcome =
  | { kind: 'none' }
  | { kind: 'resumed'; session: Session; heartbeatAgeMs: number }
  | {
      kind: 'needs-confirmation';
      session: Session; // still 'running'
      suggestedEndWall: number; // lastHeartbeat.wall
      suggestedCountedMs: number;
      heartbeatAgeMs: number;
    }
  | { kind: 'auto-finalized'; session: Session; heartbeatAgeMs: number }; // status 'recovered'

export function recoverActiveSession(
  snapshot: ActiveSessionSnapshot | null,
  now: ClockStamp,
  policy: RecoveryPolicy = DEFAULT_RECOVERY_POLICY,
): RecoveryOutcome {
  if (!snapshot || snapshot.session.status !== 'running') return { kind: 'none' };

  const session = snapshot.session;
  const hb = snapshot.lastHeartbeat;
  const ageMs = now.wall - hb.wall;

  // Clock moved backwards meaningfully since the last heartbeat: don't trust
  // either "resume" or "silent finalize" — ask the user.
  if (ageMs < -policy.freshWithinMs) {
    return {
      kind: 'needs-confirmation',
      session,
      suggestedEndWall: hb.wall,
      suggestedCountedMs: countedAt(session, hb),
      heartbeatAgeMs: ageMs,
    };
  }

  if (ageMs <= policy.freshWithinMs) {
    return { kind: 'resumed', session, heartbeatAgeMs: ageMs };
  }

  if (ageMs >= policy.autoFinalizeAfterMs) {
    const finalized: Session = {
      ...session,
      status: 'recovered',
      endWall: hb.wall,
      endSource: 'system',
      pauses: closeOpenPause(session.pauses, hb.wall),
      updatedAt: now.wall,
    };
    return { kind: 'auto-finalized', session: finalized, heartbeatAgeMs: ageMs };
  }

  return {
    kind: 'needs-confirmation',
    session,
    suggestedEndWall: hb.wall,
    suggestedCountedMs: countedAt(session, hb),
    heartbeatAgeMs: ageMs,
  };
}

/** Apply the user's decision from a `needs-confirmation` outcome. */
export function resolveRecovery(
  session: Session,
  decision:
    | { kind: 'keep-running' }
    | { kind: 'finalize-at-heartbeat'; heartbeat: ClockStamp }
    | { kind: 'finalize-at'; endWall: number }
    | { kind: 'discard' },
  now: ClockStamp,
): { active: Session | null; completed: Session | null } {
  switch (decision.kind) {
    case 'keep-running':
      return { active: session, completed: null };
    case 'discard':
      return {
        active: null,
        completed: {
          ...session,
          status: 'abandoned',
          endWall: now.wall,
          endSource: 'system',
          pauses: closeOpenPause(session.pauses, now.wall),
          updatedAt: now.wall,
        },
      };
    case 'finalize-at-heartbeat':
      return {
        active: null,
        completed: {
          ...session,
          status: 'recovered',
          endWall: decision.heartbeat.wall,
          endSource: 'system',
          pauses: closeOpenPause(session.pauses, decision.heartbeat.wall),
          updatedAt: now.wall,
        },
      };
    case 'finalize-at': {
      const endWall = Math.max(session.start.wall, decision.endWall);
      return {
        active: null,
        completed: {
          ...session,
          status: 'recovered',
          endWall,
          endSource: 'system',
          pauses: closeOpenPause(session.pauses, endWall),
          updatedAt: now.wall,
        },
      };
    }
  }
}

function countedAt(session: Session, at: ClockStamp): number {
  return computeElapsed({ start: session.start, pauses: session.pauses, endWall: at.wall }, at).countedMs;
}

function closeOpenPause(pauses: Session['pauses'], atWall: number): Session['pauses'] {
  if (pauses.length === 0) return pauses;
  const last = pauses[pauses.length - 1]!;
  if (last.resumedAt != null) return pauses;
  const copy = pauses.slice();
  copy[copy.length - 1] = { ...last, resumedAt: Math.max(last.pausedAt, atWall) };
  return copy;
}
