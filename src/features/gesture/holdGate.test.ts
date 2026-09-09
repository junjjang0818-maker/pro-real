import { describe, it, expect } from 'vitest';
import { HoldGate } from './holdGate';

const cfg = { framesForConfirm: 4, holdDurationMs: 300, cooldownMs: 1000, distinctGestureDebounceMs: 500 };

describe('HoldGate', () => {
  it('confirms only after enough agreeing frames AND enough hold time', () => {
    const g = new HoldGate(cfg);
    expect(g.feed(3, 0).confirmed).toBe(false); // 1
    expect(g.feed(3, 100).confirmed).toBe(false); // 2
    expect(g.feed(3, 200).confirmed).toBe(false); // 3
    // 4 frames now, but held 300ms exactly at t=300
    const r = g.feed(3, 300);
    expect(r).toMatchObject({ confirmed: true, signal: 3 });
  });

  it('does not confirm if frames are enough but hold time is not', () => {
    const g = new HoldGate({ ...cfg, holdDurationMs: 2000 });
    for (const t of [0, 50, 100, 150, 200]) expect(g.feed(2, t).confirmed).toBe(false);
  });

  it('a changing signal restarts the candidate', () => {
    const g = new HoldGate(cfg);
    g.feed(1, 0);
    g.feed(1, 100);
    g.feed(2, 200); // reset
    g.feed(2, 300);
    expect(g.feed(2, 400).confirmed).toBe(false); // only 3 frames of "2"
    expect(g.feed(2, 500).confirmed).toBe(true); // 4 frames + 300ms held
  });

  it('a null (no hand) frame breaks the streak', () => {
    const g = new HoldGate(cfg);
    g.feed(5, 0);
    g.feed(5, 100);
    g.feed(null, 200);
    g.feed(5, 300);
    g.feed(5, 400);
    expect(g.feed(5, 500).confirmed).toBe(false); // streak restarted at t=300
  });

  it('enforces a cooldown after a confirm', () => {
    const g = new HoldGate(cfg);
    for (const t of [0, 100, 200, 300]) g.feed(3, t);
    // confirmed at 300; cooldown until 1300
    expect(g.feed(3, 400)).toMatchObject({ confirmed: false, inCooldown: true });
    expect(g.feed(3, 1200).inCooldown).toBe(true);
    // after cooldown, a fresh hold confirms again
    for (const t of [1400, 1500, 1600]) expect(g.feed(3, t).confirmed).toBe(false);
    expect(g.feed(3, 1700).confirmed).toBe(true);
  });

  it('debounces a different signal right after a confirm', () => {
    const g = new HoldGate({ ...cfg, cooldownMs: 0 });
    for (const t of [0, 100, 200, 300]) g.feed(3, t); // confirm 3 at 300
    // within 500ms, "2" is ignored...
    for (const t of [350, 400, 450, 500, 550, 600, 650]) g.feed(2, t);
    expect(g.feed(2, 700).confirmed).toBe(false);
    // after the debounce window, "2" can build up and confirm
    for (const t of [850, 950, 1050]) g.feed(2, t);
    expect(g.feed(2, 1150).confirmed).toBe(true);
  });

  it('reports candidate progress for a UI', () => {
    const g = new HoldGate(cfg);
    expect(g.feed(1, 0).progressFrames).toBe(1);
    expect(g.feed(1, 50).progressFrames).toBe(2);
  });
});
