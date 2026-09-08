import type { ClockStamp } from '../time/clock';
import type { PauseInterval, Session } from './types';

/**
 * Elapsed-time calculation — the heart of the "no setInterval accumulation"
 * requirement.
 *
 * `countedMs` is ALWAYS a pure function of stored timestamps and `now`. The UI
 * may run a setInterval(250ms) but only to trigger re-render; it never adds to
 * a counter. This means a 40-minute background gap with zero JS ticks still
 * yields exactly 40 minutes.
 *
 * Clock-anomaly handling (NTP correction / manual clock change / DST):
 *   While a session is still running AND we're in the same boot, we compare the
 *   wall delta against the monotonic delta. If they disagree beyond a small
 *   threshold we distrust the wall clock and use the monotonic delta instead,
 *   flagging `clockAnomaly`. Monotonic can't be edited and can't go backwards.
 *   After a reboot the monotonic clock has reset, so we can only fall back to
 *   wall (documented limitation).
 */

export const CLOCK_ANOMALY_THRESHOLD_MS = 5_000;

export type ElapsedBasis = 'wall' | 'monotonic' | 'wall-clamped';

export interface ElapsedResult {
  /** active study time = gross - paused, never negative. */
  countedMs: number;
  /** raw span before subtracting pauses. */
  grossMs: number;
  pausedMs: number;
  clockAnomaly: boolean;
  basis: ElapsedBasis;
}

type ElapsedInput = Pick<Session, 'start' | 'pauses' | 'endWall'>;

export function computeElapsed(session: ElapsedInput, now: ClockStamp): ElapsedResult {
  const { start } = session;
  const isRunning = session.endWall == null;
  const endWall = session.endWall ?? now.wall;

  let grossMs = endWall - start.wall;
  let basis: ElapsedBasis = 'wall';
  let clockAnomaly = false;

  // Monotonic cross-check is only valid for a still-running session within the
  // same boot. A finalized session already has a trusted endWall.
  if (isRunning && now.bootId === start.bootId) {
    const wallDelta = now.wall - start.wall;
    const monoDelta = now.monotonic - start.monotonic;
    if (Math.abs(wallDelta - monoDelta) > CLOCK_ANOMALY_THRESHOLD_MS) {
      clockAnomaly = true;
      grossMs = monoDelta; // trust the forward-only, un-editable clock
      basis = 'monotonic';
    }
  }

  if (grossMs < 0) {
    // wall moved backwards and we couldn't use monotonic (e.g. across a reboot)
    grossMs = 0;
    basis = 'wall-clamped';
    clockAnomaly = true;
  }

  const pausedMs = sumPaused(session.pauses, endWall, basis === 'monotonic', start, now);
  const countedMs = Math.max(0, grossMs - pausedMs);

  return { countedMs, grossMs, pausedMs, clockAnomaly, basis };
}

function sumPaused(
  pauses: PauseInterval[],
  endWall: number,
  monotonicBasis: boolean,
  start: ClockStamp,
  now: ClockStamp,
): number {
  let total = 0;
  for (const p of pauses) {
    const resumed = p.resumedAt ?? endWall;
    let span = resumed - p.pausedAt;
    if (span < 0) span = 0;
    total += span;
  }
  // If we're on the monotonic basis the wall-based pause spans can't exceed the
  // (smaller) monotonic gross — clamp so counted time never goes negative.
  if (monotonicBasis) {
    const monoGross = now.monotonic - start.monotonic;
    if (total > monoGross) total = monoGross;
  }
  return total;
}

/**
 * Detect a wall/monotonic disagreement AT a session boundary (e.g. the moment
 * of STOP), where `now` is the boundary instant and the cross-check is
 * meaningful. Unlike `computeElapsed`, this does not short-circuit on a set
 * `endWall` because here `now` *is* the end.
 */
export function detectBoundaryAnomaly(start: ClockStamp, now: ClockStamp): boolean {
  const wallDelta = now.wall - start.wall;
  if (wallDelta < 0) return true; // wall went backwards -> definitely tampered
  if (now.bootId !== start.bootId) return false; // monotonic reset; can't compare
  const monoDelta = now.monotonic - start.monotonic;
  return Math.abs(wallDelta - monoDelta) > CLOCK_ANOMALY_THRESHOLD_MS;
}

/** Is the session currently paused? (last pause interval left open) */
export function isPaused(session: Pick<Session, 'pauses' | 'status'>): boolean {
  if (session.status !== 'running') return false;
  const last = session.pauses[session.pauses.length - 1];
  return last != null && last.resumedAt == null;
}

/** Remaining time toward `plannedMs`, or null for open-ended sessions. */
export function computeRemaining(session: ElapsedInput & { plannedMs: number | null }, now: ClockStamp): number | null {
  if (session.plannedMs == null) return null;
  const { countedMs } = computeElapsed(session, now);
  return Math.max(0, session.plannedMs - countedMs);
}
