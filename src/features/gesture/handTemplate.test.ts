import { describe, it, expect } from 'vitest';
import { normalizeHand, emptyTemplateSet, addSample, classifyHand, isCalibrated, sampleCount } from './handTemplate';
import { fingersUp, synthHand } from './synthetic';
import type { HandObservation, Landmark } from './fingerCounting';

/** shift + uniformly scale a hand — normalization must cancel both out. */
function transform(obs: HandObservation, dx: number, dy: number, k: number): HandObservation {
  return {
    ...obs,
    landmarks: obs.landmarks.map((p): Landmark => ({ x: p.x * k + dx, y: p.y * k + dy, z: p.z })),
  };
}

describe('normalizeHand', () => {
  it('is invariant to translation and scale', () => {
    const base = fingersUp(3);
    const a = normalizeHand(base)!;
    const b = normalizeHand(transform(base, 0.2, -0.15, 1.7))!;
    expect(a).toHaveLength(42);
    for (let i = 0; i < a.length; i++) expect(b[i]!).toBeCloseTo(a[i]!, 4);
  });

  it('mirror-normalizes so a Left hand lands near the same-pose Right hand', () => {
    // (synthetic Left geometry isn't a perfect mirror, so this is a loose check;
    //  real MediaPipe output is a true mirror and lands much closer.)
    const r = normalizeHand(fingersUp(2, 'Right'))!;
    const l = normalizeHand(fingersUp(2, 'Left'))!;
    let close = 0;
    for (let i = 0; i < r.length; i++) if (Math.abs(r[i]! - l[i]!) < 0.2) close++;
    expect(close).toBeGreaterThan(24); // most of the 42 coords agree
  });

  it('rejects malformed input', () => {
    expect(normalizeHand({ landmarks: [], handedness: 'Right', presence: 0.9 })).toBeNull();
  });
});

describe('classifyHand — learned-shape recognition', () => {
  function trained() {
    const set = emptyTemplateSet();
    for (let n = 0; n <= 5; n++) {
      const obs = n === 0 ? synthHand({}) : fingersUp(n as 1 | 2 | 3 | 4 | 5);
      // several slightly-shifted samples per label
      for (const [dx, dy] of [
        [0, 0],
        [0.02, -0.01],
        [-0.015, 0.02],
        [0.01, 0.01],
      ] as const) {
        addSample(set, String(n), transform(obs, dx, dy, 1 + dx));
      }
    }
    return set;
  }

  it('classifies a fresh pose to the label it was taught', () => {
    const set = trained();
    for (const n of [0, 1, 2, 3, 4, 5]) {
      const obs = n === 0 ? synthHand({}) : fingersUp(n as 1 | 2 | 3 | 4 | 5);
      const r = classifyHand(set, transform(obs, 0.05, 0.03, 1.1));
      expect(r?.label).toBe(String(n));
      expect(r!.confidence).toBeGreaterThan(0);
    }
  });

  it('returns null for a pose far from anything taught', () => {
    const set = trained();
    // a tiny, off-frame hand normalizes but sits far from every template… use a
    // deliberately weird landmark cloud
    const weird = fingersUp(3);
    weird.landmarks = weird.landmarks.map((p, i) => ({ x: (i % 3) * 0.3, y: (i % 5) * 0.2, z: 0 }));
    expect(classifyHand(set, weird, 0.3)).toBeNull();
  });

  it('respects the distance threshold — a 2-hand vs a set of only {fist, 5}', () => {
    const set = emptyTemplateSet();
    for (const [dx, dy] of [[0, 0], [0.02, 0], [0, 0.02]] as const) {
      addSample(set, '0', transform(synthHand({}), dx, dy, 1));
      addSample(set, '5', transform(fingersUp(5), dx, dy, 1));
    }
    const two = fingersUp(2);
    expect(classifyHand(set, two, 1.0)).not.toBeNull(); // loose: matches nearest of 0/5
    expect(classifyHand(set, two, 0.08)).toBeNull(); // tight: 2 is not close to 0 or 5
  });
});

describe('isCalibrated / sampleCount', () => {
  it('needs >= minSamples for every requested label', () => {
    const set = emptyTemplateSet();
    addSample(set, '0', synthHand({}));
    addSample(set, '0', synthHand({}));
    expect(sampleCount(set, '0')).toBe(2);
    expect(isCalibrated(set, ['0'], 3)).toBe(false);
    addSample(set, '0', synthHand({}));
    expect(isCalibrated(set, ['0'], 3)).toBe(true);
    expect(isCalibrated(set, ['0', '1'], 3)).toBe(false);
  });
});
