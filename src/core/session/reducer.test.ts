import { describe, it, expect } from 'vitest';
import { reduce, type Command } from './reducer';
import { stamp, MIN } from './testFixtures';
import type { Session } from './types';

function start(now = stamp({ wall: 1_000_000, monotonic: 1_000_000 }), over: Partial<Command & { type: 'START' }> = {}) {
  return reduce(null, {
    type: 'START',
    sessionId: over.sessionId ?? 'sess-1',
    subjectId: over.subjectId ?? null,
    plannedMs: over.plannedMs ?? null,
    source: over.source ?? 'button',
  }, now);
}

describe('reduce — START', () => {
  it('creates a running session attributed to the start-local-date', () => {
    const now = stamp({ wall: Date.UTC(2026, 8, 8, 15, 30), monotonic: 5_000, tzOffsetMin: 540 });
    const r = start(now, { subjectId: 'math', source: 'gesture' });
    expect(r.error).toBeUndefined();
    expect(r.active).toMatchObject({
      id: 'sess-1',
      status: 'running',
      subjectId: 'math',
      startSource: 'gesture',
      attributedLocalDate: '2026-09-09', // 00:30 Seoul
    });
    expect(r.events.map((e) => e.type)).toEqual(['SESSION_STARTED']);
  });

  it('rejects a second START while one is running (gesture+button double-fire guard)', () => {
    const first = start();
    const r = reduce(first.active, {
      type: 'START', sessionId: 'sess-2', subjectId: null, plannedMs: null, source: 'gesture',
    }, stamp({ wall: 1_000_500 }));
    expect(r.error).toBe('ALREADY_RUNNING');
    expect(r.active).toBe(first.active); // unchanged
    expect(r.events).toEqual([]);
  });

  it('a button/voice start marks the screen as touched; a gesture start does not', () => {
    expect(start(undefined, { source: 'button' }).active!.screenTouchedDuringSession).toBe(true);
    expect(start(undefined, { source: 'gesture' }).active!.screenTouchedDuringSession).toBe(false);
  });
});

describe('reduce — PAUSE / RESUME', () => {
  it('pause then resume produces matched intervals', () => {
    const s0 = start(stamp({ wall: 0, monotonic: 0 })).active!;
    const paused = reduce(s0, { type: 'PAUSE', source: 'button' }, stamp({ wall: 10 * MIN, monotonic: 10 * MIN }));
    expect(paused.active!.pauses).toEqual([{ pausedAt: 10 * MIN, resumedAt: null }]);
    const resumed = reduce(paused.active, { type: 'RESUME', source: 'button' }, stamp({ wall: 12 * MIN, monotonic: 12 * MIN }));
    expect(resumed.active!.pauses).toEqual([{ pausedAt: 10 * MIN, resumedAt: 12 * MIN }]);
  });

  it('double pause / resume-without-pause are rejected', () => {
    const s0 = start(stamp({ wall: 0 })).active!;
    const p = reduce(s0, { type: 'PAUSE', source: 'button' }, stamp({ wall: MIN }));
    expect(reduce(p.active, { type: 'PAUSE', source: 'button' }, stamp({ wall: 2 * MIN })).error).toBe('ALREADY_PAUSED');
    expect(reduce(s0, { type: 'RESUME', source: 'button' }, stamp({ wall: MIN })).error).toBe('NOT_PAUSED');
  });
});

describe('reduce — STOP', () => {
  it('finalizes: status completed, endWall set, pause closed, rating recorded', () => {
    const s0 = start(stamp({ wall: 0, monotonic: 0 })).active!;
    const paused = reduce(s0, { type: 'PAUSE', source: 'button' }, stamp({ wall: 5 * MIN, monotonic: 5 * MIN })).active!;
    const r = reduce(paused, { type: 'STOP', source: 'gesture', focusSelfRating: 4 }, stamp({ wall: 20 * MIN, monotonic: 20 * MIN }));
    expect(r.active).toBeNull();
    const done = r.completed as Session;
    expect(done.status).toBe('completed');
    expect(done.endWall).toBe(20 * MIN);
    expect(done.endSource).toBe('gesture');
    expect(done.focusSelfRating).toBe(4);
    expect(done.pauses).toEqual([{ pausedAt: 5 * MIN, resumedAt: 20 * MIN }]);
    expect(r.events.map((e) => e.type)).toEqual(['SESSION_STOPPED', 'SELF_RATING_SET']);
  });

  it('STOP with no active session is rejected', () => {
    expect(reduce(null, { type: 'STOP', source: 'button' }, stamp({ wall: 1 })).error).toBe('NO_ACTIVE_SESSION');
  });

  it('rejects an out-of-range rating', () => {
    const s0 = start(stamp({ wall: 0 })).active!;
    expect(
      reduce(s0, { type: 'STOP', source: 'button', focusSelfRating: 9 as unknown as 5 }, stamp({ wall: MIN })).error,
    ).toBe('INVALID_RATING');
  });

  it('propagates a clock anomaly detected at stop time', () => {
    const s0 = start(stamp({ wall: 1_000_000, monotonic: 1_000_000 })).active!;
    // wall jumped an hour, monotonic only 3 min
    const r = reduce(s0, { type: 'STOP', source: 'button' }, stamp({ wall: 1_000_000 + 3_600_000, monotonic: 1_000_000 + 3 * MIN }));
    expect(r.completed!.clockAnomaly).toBe(true);
  });
});

describe('reduce — TAG_SUBJECT / SET_RATING / MARK_SCREEN_TOUCHED', () => {
  it('tags subject mid-session', () => {
    const s0 = start(stamp({ wall: 0 })).active!;
    const r = reduce(s0, { type: 'TAG_SUBJECT', subjectId: 'english', source: 'gesture' }, stamp({ wall: MIN }));
    expect(r.active!.subjectId).toBe('english');
    expect(r.events[0]!.type).toBe('SUBJECT_TAGGED');
  });

  it('MARK_SCREEN_TOUCHED is idempotent (no duplicate events)', () => {
    const s0 = start(stamp({ wall: 0 }), { source: 'gesture' }).active!;
    const first = reduce(s0, { type: 'MARK_SCREEN_TOUCHED' }, stamp({ wall: MIN }));
    expect(first.active!.screenTouchedDuringSession).toBe(true);
    expect(first.events).toHaveLength(1);
    const second = reduce(first.active, { type: 'MARK_SCREEN_TOUCHED' }, stamp({ wall: 2 * MIN }));
    expect(second.events).toHaveLength(0);
  });
});

describe('reduce — purity', () => {
  it('never mutates the input session', () => {
    const s0 = start(stamp({ wall: 0, monotonic: 0 })).active!;
    const snapshot = JSON.stringify(s0);
    reduce(s0, { type: 'PAUSE', source: 'button' }, stamp({ wall: MIN }));
    reduce(s0, { type: 'STOP', source: 'button' }, stamp({ wall: MIN }));
    reduce(s0, { type: 'TAG_SUBJECT', subjectId: 'x', source: 'button' }, stamp({ wall: MIN }));
    expect(JSON.stringify(s0)).toBe(snapshot);
  });
});
