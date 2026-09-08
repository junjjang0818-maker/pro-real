import { describe, it, expect } from 'vitest';
import { countExtendedFingers, DEFAULT_FINGER_CONFIG } from './fingerCounting';
import { synthHand, fingersUp } from './testFixtures';

describe('countExtendedFingers — counts 0..5', () => {
  it.each([0, 1, 2, 3, 4, 5] as const)('counts %i extended fingers (right hand)', (n) => {
    const r = countExtendedFingers(fingersUp(n));
    expect(r.usable).toBe(true);
    expect(r.count).toBe(n);
  });

  it.each([1, 2, 3, 5] as const)('counts %i extended fingers (left hand)', (n) => {
    expect(countExtendedFingers(fingersUp(n, 'Left')).count).toBe(n);
  });

  it('reports which specific fingers are up', () => {
    const r = countExtendedFingers(synthHand({ index: true, ring: true }));
    expect(r.perFinger).toEqual([false, true, false, true, false]);
    expect(r.count).toBe(2);
  });
});

describe('countExtendedFingers — 오인식 방지 gates', () => {
  it('rejects low model presence', () => {
    const r = countExtendedFingers(synthHand({ index: true }, { presence: 0.4 }));
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('low-presence');
  });

  it('rejects a hand that is too small / far away', () => {
    const r = countExtendedFingers(synthHand({ index: true, middle: true }, { scale: 0.3 }));
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('hand-too-small');
  });

  it('rejects landmarks that fall outside the frame', () => {
    const r = countExtendedFingers(synthHand({ index: true }, { offsetX: 0.6 }));
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('off-frame');
  });

  it('rejects malformed landmark arrays', () => {
    const bad = { landmarks: [{ x: 0.5, y: 0.5, z: 0 }], handedness: 'Right' as const, presence: 0.9 };
    const r = countExtendedFingers(bad);
    expect(r.usable).toBe(false);
    expect(r.reason).toBe('bad-landmarks');
  });

  it('rejects NaN coordinates', () => {
    const h = synthHand({ index: true });
    h.landmarks[8] = { x: NaN, y: 0.3, z: 0 };
    expect(countExtendedFingers(h).usable).toBe(false);
  });

  it('a fist (nothing extended) is usable and counts 0', () => {
    const r = countExtendedFingers(synthHand({}));
    expect(r.usable).toBe(true);
    expect(r.count).toBe(0);
  });
});

describe('DEFAULT_FINGER_CONFIG', () => {
  it('has conservative thresholds', () => {
    expect(DEFAULT_FINGER_CONFIG.minPresence).toBeGreaterThanOrEqual(0.6);
    expect(DEFAULT_FINGER_CONFIG.minHandSpan).toBeGreaterThan(0);
  });
});
