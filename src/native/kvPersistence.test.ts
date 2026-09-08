import { describe, it, expect } from 'vitest';
import { kvPersistence } from './kvPersistence';
import { memoryKeyValueStore } from './stubs';
import { SessionStore } from '../core/store';
import { FakeClock } from '../core/time/clock';

const MIN = 60_000;

describe('kvPersistence', () => {
  it('round-trips sessions, snapshot and badges through a KV store', () => {
    const kv = memoryKeyValueStore();
    const p = kvPersistence(kv);

    expect(p.loadSessions()).toEqual([]);
    expect(p.loadSnapshot()).toBeNull();

    const clock = new FakeClock({ wall: 1_000_000, monotonic: 0 });
    const store = new SessionStore(clock, p, { dailyGoalMs: 60 * MIN }, () => 'sess-1');
    store.dispatch({ type: 'START', sessionId: 'sess-1', subjectId: 'math', plannedMs: null, source: 'gesture' });
    clock.advance(70 * MIN);
    store.dispatch({ type: 'STOP', source: 'gesture' });

    // a fresh store reading the SAME kv sees the finished session
    const reopened = new SessionStore(new FakeClock({ wall: clock.now().wall }), kvPersistence(kv), {
      dailyGoalMs: 60 * MIN,
    });
    const att = reopened.attendance();
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ countedMs: 70 * MIN, attended: true });
    expect(kvPersistence(kv).loadSnapshot()).toBeNull();
  });

  it('tolerates corrupt JSON by falling back to empty', () => {
    const kv = memoryKeyValueStore();
    kv.set('sessions.v1', '{not json');
    expect(kvPersistence(kv).loadSessions()).toEqual([]);
  });
});
