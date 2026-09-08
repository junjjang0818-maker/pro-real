import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore, inMemoryPersistence, type Persistence } from './store';
import { FakeClock } from './time/clock';
import { computeDailyAttendance } from './derivations/attendance';
import { computeStreak } from './derivations/streak';
import type { Subject } from './subjects';
import type { ActiveSessionSnapshot } from './session/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const SEOUL = 540;

/** epoch ms for a Seoul wall time */
function seoul(y: number, mo: number, d: number, h: number, mi = 0): number {
  return Date.UTC(y, mo - 1, d, h, mi) - SEOUL * 60_000;
}

let ids = 0;
const nextId = () => `sess-${++ids}`;

beforeEach(() => {
  ids = 0;
});

function makeStore(startWall: number, persist: Persistence = inMemoryPersistence()) {
  const clock = new FakeClock({ wall: startWall, monotonic: 0, tzId: 'Asia/Seoul', tzOffsetMin: SEOUL });
  const store = new SessionStore(clock, persist, { dailyGoalMs: 60 * MIN }, nextId);
  return { clock, store, persist };
}

const math: Subject = {
  id: 'math', label: '수학', colorToken: 'red', gestureFingerCount: 1,
  weeklyTargetMs: 7 * HOUR, archivedAt: null, createdAt: 0,
};

describe('SessionStore — 데이터 불일치 방지 (single source of truth)', () => {
  it('a completed session immediately shows up in attendance, streak and stats — all from one list', () => {
    const { clock, store } = makeStore(seoul(2026, 9, 8, 9, 0));

    store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });
    clock.advance(70 * MIN);
    const res = store.dispatch({ type: 'STOP', source: 'gesture', focusSelfRating: 4 });

    expect(res.ok).toBe(true);
    expect(res.completed?.status).toBe('completed');

    const att = store.attendance();
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ localDate: '2026-09-08', attended: true, countedMs: 70 * MIN });

    expect(store.streak().current).toBe(1);
    expect(store.subjectStats([math])[0]).toMatchObject({ actualMs: 70 * MIN });

    // independent recomputation from the persisted session list must match
    const persistedSessions = store['persist'].loadSessions();
    const recomputed = computeDailyAttendance({ sessions: persistedSessions, defaultGoalMs: 60 * MIN });
    expect(recomputed).toEqual(att);
  });

  it('while a session is RUNNING, attendance already reflects it (no "timer on, attendance off")', () => {
    const { clock, store } = makeStore(seoul(2026, 9, 8, 9, 0));
    store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });

    clock.advance(61 * MIN);
    const att = store.attendance();
    expect(att[0]).toMatchObject({ localDate: '2026-09-08', attended: true });
    expect(store.streak().current).toBe(1);
    // still running
    expect(store.getActive()?.status).toBe('running');
  });

  it('a rejected command changes nothing', () => {
    const { store } = makeStore(seoul(2026, 9, 8, 9, 0));
    store.dispatch({ type: 'START', sessionId: nextId(), subjectId: null, plannedMs: null, source: 'button' });
    const before = JSON.stringify(store['persist'].loadSessions());

    const res = store.dispatch({ type: 'START', sessionId: nextId(), subjectId: null, plannedMs: null, source: 'gesture' });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('ALREADY_RUNNING');
    expect(JSON.stringify(store['persist'].loadSessions())).toBe(before);
  });

  it('gesture and button inputs are indistinguishable to attendance/streak', () => {
    const a = makeStore(seoul(2026, 9, 7, 9, 0));
    a.store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });
    a.clock.advance(65 * MIN);
    a.store.dispatch({ type: 'STOP', source: 'gesture' });

    ids = 0;
    const b = makeStore(seoul(2026, 9, 7, 9, 0));
    b.store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'button' });
    b.clock.advance(65 * MIN);
    b.store.dispatch({ type: 'STOP', source: 'button' });

    expect(a.store.attendance().map((x) => ({ ...x, sessionIds: [] })))
      .toEqual(b.store.attendance().map((x) => ({ ...x, sessionIds: [] })));
    expect(a.store.streak().current).toBe(b.store.streak().current);
  });
});

describe('SessionStore — persistence + crash recovery', () => {
  it('writes a snapshot on every transition and clears it on stop', () => {
    const persist = inMemoryPersistence();
    const { clock, store } = makeStore(seoul(2026, 9, 8, 9, 0), persist);

    store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });
    expect(persist.loadSnapshot()?.session.status).toBe('running');

    clock.advance(10 * MIN);
    store.heartbeat();
    expect(persist.loadSnapshot()?.lastHeartbeat.wall).toBe(seoul(2026, 9, 8, 9, 10));

    clock.advance(20 * MIN);
    store.dispatch({ type: 'STOP', source: 'gesture' });
    expect(persist.loadSnapshot()).toBeNull();
  });

  it('recovers a running session from a snapshot after a process kill (iOS 강제 종료)', () => {
    const persist = inMemoryPersistence();
    const first = makeStore(seoul(2026, 9, 8, 9, 0), persist);
    first.store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });
    first.clock.advance(25 * MIN);
    first.store.heartbeat(); // last heartbeat at 09:25

    // app killed; relaunch 40 min later -> stale -> needs confirmation
    const relaunch = makeStore(seoul(2026, 9, 8, 10, 5), persist);
    const outcome = relaunch.store.inspectRecovery();
    expect(outcome.kind).toBe('needs-confirmation');
    if (outcome.kind !== 'needs-confirmation') throw new Error('bad');
    expect(outcome.suggestedCountedMs).toBe(25 * MIN); // start -> last heartbeat, NOT to "now"

    relaunch.store.applyRecovery(outcome, { kind: 'finalize-at-heartbeat', heartbeat: persist.loadSnapshot()!.lastHeartbeat });

    const att = relaunch.store.attendance();
    expect(att[0]).toMatchObject({ localDate: '2026-09-08', countedMs: 25 * MIN });
    expect(persist.loadSnapshot()).toBeNull();
  });

  it('auto-finalizes a very stale (>12h) snapshot at the heartbeat', () => {
    const persist = inMemoryPersistence();
    const first = makeStore(seoul(2026, 9, 8, 22, 0), persist);
    first.store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });
    first.clock.advance(30 * MIN);
    first.store.heartbeat();

    const relaunch = makeStore(seoul(2026, 9, 9, 20, 0), persist); // ~21h later
    const outcome = relaunch.store.inspectRecovery();
    expect(outcome.kind).toBe('auto-finalized');
    relaunch.store.applyRecovery(outcome);

    const att = relaunch.store.attendance();
    // session started 22:00 on 09-08 -> attributed to 09-08, 30 min counted
    expect(att[0]).toMatchObject({ localDate: '2026-09-08', countedMs: 30 * MIN });
  });
});

describe('SessionStore — badge award through the store is idempotent', () => {
  it('does not re-award first-session on subsequent dispatches', () => {
    const { clock, store } = makeStore(seoul(2026, 9, 8, 9, 0));
    store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });
    clock.advance(30 * MIN);
    const stop = store.dispatch({ type: 'STOP', source: 'gesture' });
    expect(stop.badges.newlyAwarded.map((b) => b.id)).toContain('first-session');

    clock.advance(5 * MIN);
    store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'gesture' });
    clock.advance(30 * MIN);
    const stop2 = store.dispatch({ type: 'STOP', source: 'gesture' });
    expect(stop2.badges.newlyAwarded.map((b) => b.id)).not.toContain('first-session');
  });
});

describe('SessionStore — 자정 경계 through the store', () => {
  it('a session started at 23:40 and stopped at 00:20 counts fully toward the start day', () => {
    const { clock, store } = makeStore(seoul(2026, 9, 8, 23, 40));
    store.dispatch({ type: 'START', sessionId: nextId(), subjectId: 'math', plannedMs: null, source: 'button' });
    clock.advance(40 * MIN); // now 00:20 on 09-09
    store.dispatch({ type: 'STOP', source: 'button' });

    const att = store.attendance();
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ localDate: '2026-09-08', countedMs: 40 * MIN, crossedMidnight: true });
  });
});
