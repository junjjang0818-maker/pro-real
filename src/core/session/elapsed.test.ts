import { describe, it, expect } from 'vitest';
import { computeElapsed, computeRemaining, isPaused, CLOCK_ANOMALY_THRESHOLD_MS } from './elapsed';
import { stamp, makeSession, MIN, HOUR } from './testFixtures';

describe('computeElapsed — 백그라운드 오차 (no setInterval accumulation)', () => {
  it('a 40-minute gap with ZERO ticks still yields exactly 40 minutes', () => {
    const start = stamp({ wall: 1_000_000, monotonic: 5_000 });
    const session = makeSession({ start });
    // "now" is 40 min later on BOTH clocks; no intermediate calls happened.
    const now = stamp({ wall: start.wall + 40 * MIN, monotonic: start.monotonic + 40 * MIN });
    const r = computeElapsed(session, now);
    expect(r.countedMs).toBe(40 * MIN);
    expect(r.basis).toBe('wall');
    expect(r.clockAnomaly).toBe(false);
  });

  it('is idempotent — calling repeatedly never drifts', () => {
    const start = stamp({ wall: 0, monotonic: 0 });
    const session = makeSession({ start });
    const now = stamp({ wall: 25 * MIN, monotonic: 25 * MIN });
    const a = computeElapsed(session, now).countedMs;
    const b = computeElapsed(session, now).countedMs;
    const c = computeElapsed(session, now).countedMs;
    expect([a, b, c]).toEqual([25 * MIN, 25 * MIN, 25 * MIN]);
  });

  it('subtracts paused intervals', () => {
    const start = stamp({ wall: 0, monotonic: 0 });
    const session = makeSession({
      start,
      pauses: [{ pausedAt: 10 * MIN, resumedAt: 15 * MIN }],
    });
    const now = stamp({ wall: 30 * MIN, monotonic: 30 * MIN });
    expect(computeElapsed(session, now).countedMs).toBe(25 * MIN);
  });

  it('handles a still-open pause (session paused right now)', () => {
    const start = stamp({ wall: 0, monotonic: 0 });
    const session = makeSession({ start, pauses: [{ pausedAt: 20 * MIN, resumedAt: null }] });
    const now = stamp({ wall: 50 * MIN, monotonic: 50 * MIN });
    // counted stops accruing at pausedAt
    expect(computeElapsed(session, now).countedMs).toBe(20 * MIN);
  });
});

describe('computeElapsed — 시계 조작 / NTP 보정', () => {
  it('an NTP jump forward (wall +1h, real +5min) is caught; monotonic is trusted', () => {
    const start = stamp({ wall: 1_000_000, monotonic: 200_000 });
    const session = makeSession({ start });
    const now = stamp({
      wall: start.wall + HOUR, // wall claims 1 hour
      monotonic: start.monotonic + 5 * MIN, // only 5 real minutes elapsed
    });
    const r = computeElapsed(session, now);
    expect(r.basis).toBe('monotonic');
    expect(r.clockAnomaly).toBe(true);
    expect(r.countedMs).toBe(5 * MIN);
  });

  it('a backwards clock edit yields clamped, non-negative time', () => {
    const start = stamp({ wall: 10 * HOUR, monotonic: 10 * HOUR });
    const session = makeSession({ start });
    // wall set back 3h; monotonic barely moved -> disagreement -> monotonic basis
    const now = stamp({ wall: 7 * HOUR, monotonic: 10 * HOUR + 2 * MIN });
    const r = computeElapsed(session, now);
    expect(r.countedMs).toBe(2 * MIN);
    expect(r.clockAnomaly).toBe(true);
  });

  it('small clock jitter under the threshold is NOT flagged', () => {
    const start = stamp({ wall: 0, monotonic: 0 });
    const session = makeSession({ start });
    const skew = CLOCK_ANOMALY_THRESHOLD_MS - 1;
    const now = stamp({ wall: 30 * MIN + skew, monotonic: 30 * MIN });
    const r = computeElapsed(session, now);
    expect(r.clockAnomaly).toBe(false);
    expect(r.basis).toBe('wall');
    expect(r.countedMs).toBe(30 * MIN + skew);
  });

  it('after a reboot (bootId changed) monotonic cross-check is skipped, falls back to wall', () => {
    const start = stamp({ wall: 1_000_000, monotonic: 900_000, bootId: 'boot-1' });
    const session = makeSession({ start });
    const now = stamp({ wall: start.wall + 20 * MIN, monotonic: 3_000, bootId: 'boot-2' });
    const r = computeElapsed(session, now);
    expect(r.basis).toBe('wall');
    expect(r.countedMs).toBe(20 * MIN);
  });

  it('a finalized session trusts its stored endWall (no monotonic second-guessing)', () => {
    const start = stamp({ wall: 0, monotonic: 0 });
    const session = makeSession({ start, endWall: 45 * MIN, status: 'completed' });
    const now = stamp({ wall: 10 * HOUR, monotonic: 1_000 }); // wildly off, irrelevant
    expect(computeElapsed(session, now).countedMs).toBe(45 * MIN);
  });
});

describe('isPaused / computeRemaining', () => {
  it('isPaused reflects an open trailing pause only while running', () => {
    const start = stamp({ wall: 0 });
    expect(isPaused(makeSession({ start, pauses: [{ pausedAt: 1, resumedAt: null }] }))).toBe(true);
    expect(isPaused(makeSession({ start, pauses: [{ pausedAt: 1, resumedAt: 2 }] }))).toBe(false);
    expect(
      isPaused(makeSession({ start, status: 'completed', pauses: [{ pausedAt: 1, resumedAt: null }] })),
    ).toBe(false);
  });

  it('computeRemaining counts down toward plannedMs and floors at 0', () => {
    const start = stamp({ wall: 0, monotonic: 0 });
    const session = makeSession({ start, plannedMs: 25 * MIN });
    expect(computeRemaining(session, stamp({ wall: 10 * MIN, monotonic: 10 * MIN }))).toBe(15 * MIN);
    expect(computeRemaining(session, stamp({ wall: 90 * MIN, monotonic: 90 * MIN }))).toBe(0);
    expect(computeRemaining(makeSession({ start }), stamp({ wall: MIN, monotonic: MIN }))).toBeNull();
  });
});
