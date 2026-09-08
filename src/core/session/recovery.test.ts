import { describe, it, expect } from 'vitest';
import {
  recoverActiveSession,
  resolveRecovery,
  DEFAULT_RECOVERY_POLICY,
  type RecoveryPolicy,
} from './recovery';
import { stamp, makeSession, MIN, HOUR } from './testFixtures';
import type { ActiveSessionSnapshot } from './types';

const POLICY: RecoveryPolicy = { freshWithinMs: 90_000, autoFinalizeAfterMs: 12 * HOUR };

function snap(over: Partial<ActiveSessionSnapshot> = {}): ActiveSessionSnapshot {
  const start = stamp({ wall: 1_000_000, monotonic: 1_000_000 });
  return {
    session: over.session ?? makeSession({ start, status: 'running', id: 'sess-1' }),
    lastHeartbeat: over.lastHeartbeat ?? stamp({ wall: 1_000_000 + 20 * MIN, monotonic: 1_000_000 + 20 * MIN }),
    snapshotVersion: over.snapshotVersion ?? 3,
  };
}

describe('recoverActiveSession — iOS 강제 종료 복구', () => {
  it('no snapshot => nothing to recover', () => {
    expect(recoverActiveSession(null, stamp({ wall: 0 }), POLICY)).toEqual({ kind: 'none' });
  });

  it('a non-running snapshot => nothing to recover', () => {
    const s = snap({ session: makeSession({ start: stamp({ wall: 0 }), status: 'completed' }) });
    expect(recoverActiveSession(s, stamp({ wall: 10 }), POLICY).kind).toBe('none');
  });

  it('fresh heartbeat (< 90s ago) => resume as-is', () => {
    const s = snap();
    const now = stamp({ wall: s.lastHeartbeat.wall + 30_000 });
    const out = recoverActiveSession(s, now, POLICY);
    expect(out.kind).toBe('resumed');
    if (out.kind === 'resumed') expect(out.session.id).toBe('sess-1');
  });

  it('stale heartbeat (minutes ago, < 12h) => needs-confirmation with a conservative end', () => {
    const s = snap();
    const now = stamp({ wall: s.lastHeartbeat.wall + 40 * MIN });
    const out = recoverActiveSession(s, now, POLICY);
    expect(out.kind).toBe('needs-confirmation');
    if (out.kind === 'needs-confirmation') {
      expect(out.suggestedEndWall).toBe(s.lastHeartbeat.wall); // NOT "now"
      expect(out.suggestedCountedMs).toBe(20 * MIN); // start->lastHeartbeat
    }
  });

  it('very stale heartbeat (>= 12h) => auto-finalized at the heartbeat, status recovered', () => {
    const s = snap();
    const now = stamp({ wall: s.lastHeartbeat.wall + 13 * HOUR });
    const out = recoverActiveSession(s, now, POLICY);
    expect(out.kind).toBe('auto-finalized');
    if (out.kind === 'auto-finalized') {
      expect(out.session.status).toBe('recovered');
      expect(out.session.endWall).toBe(s.lastHeartbeat.wall);
      expect(out.session.endSource).toBe('system');
    }
  });

  it('clock moved backwards since the heartbeat => needs-confirmation (never silent)', () => {
    const s = snap();
    const now = stamp({ wall: s.lastHeartbeat.wall - 30 * MIN });
    expect(recoverActiveSession(s, now, POLICY).kind).toBe('needs-confirmation');
  });

  it('an open pause is closed when auto-finalizing', () => {
    const start = stamp({ wall: 0, monotonic: 0 });
    const session = makeSession({ start, status: 'running', pauses: [{ pausedAt: 5 * MIN, resumedAt: null }] });
    const s = snap({ session, lastHeartbeat: stamp({ wall: 8 * MIN, monotonic: 8 * MIN }) });
    const out = recoverActiveSession(s, stamp({ wall: 8 * MIN + 13 * HOUR }), POLICY);
    expect(out.kind).toBe('auto-finalized');
    if (out.kind === 'auto-finalized') {
      expect(out.session.pauses).toEqual([{ pausedAt: 5 * MIN, resumedAt: 8 * MIN }]);
    }
  });
});

describe('resolveRecovery — user decision from a needs-confirmation prompt', () => {
  const session = makeSession({ start: stamp({ wall: 0, monotonic: 0 }), status: 'running' });
  const hb = stamp({ wall: 30 * MIN, monotonic: 30 * MIN });
  const now = stamp({ wall: 90 * MIN, monotonic: 90 * MIN });

  it('keep-running leaves it active', () => {
    const r = resolveRecovery(session, { kind: 'keep-running' }, now);
    expect(r.active).toBe(session);
    expect(r.completed).toBeNull();
  });

  it('finalize-at-heartbeat closes it at the heartbeat wall, status recovered', () => {
    const r = resolveRecovery(session, { kind: 'finalize-at-heartbeat', heartbeat: hb }, now);
    expect(r.completed!.status).toBe('recovered');
    expect(r.completed!.endWall).toBe(30 * MIN);
  });

  it('finalize-at clamps an end earlier than start', () => {
    const r = resolveRecovery(session, { kind: 'finalize-at', endWall: -5 }, now);
    expect(r.completed!.endWall).toBe(session.start.wall);
  });

  it('discard marks it abandoned', () => {
    const r = resolveRecovery(session, { kind: 'discard' }, now);
    expect(r.completed!.status).toBe('abandoned');
  });
});

describe('DEFAULT_RECOVERY_POLICY', () => {
  it('has sane bounds', () => {
    expect(DEFAULT_RECOVERY_POLICY.freshWithinMs).toBeLessThan(DEFAULT_RECOVERY_POLICY.autoFinalizeAfterMs);
  });
});
