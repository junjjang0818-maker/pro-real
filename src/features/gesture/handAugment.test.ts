import { describe, it, expect } from 'vitest';
import { augmentVec, augmentDataset } from './handAugment';
import { mulberry32 } from './rng';
import { normalizeHand } from './handTemplate';
import { fingersUp } from './synthetic';

describe('augmentVec', () => {
  it('keeps the pose recognizably the same (small perturbation)', () => {
    const rand = mulberry32(1);
    const base = normalizeHand(fingersUp(3))!;
    const aug = augmentVec(base, rand);
    let maxDelta = 0;
    for (let i = 0; i < base.length; i++) maxDelta = Math.max(maxDelta, Math.abs(aug[i]! - base[i]!));
    expect(aug).toHaveLength(42);
    expect(maxDelta).toBeLessThan(0.6); // rotated/scaled/jittered but not wild
  });

  it('is deterministic given a seed', () => {
    const base = normalizeHand(fingersUp(2))!;
    const a = augmentVec(base, mulberry32(42));
    const b = augmentVec(base, mulberry32(42));
    expect(a).toEqual(b);
  });

  it('produces different variants on successive draws', () => {
    const rand = mulberry32(9);
    const base = normalizeHand(fingersUp(4))!;
    const a = augmentVec(base, rand);
    const b = augmentVec(base, rand);
    expect(a).not.toEqual(b);
  });
});

describe('augmentDataset', () => {
  it('expands each sample to 1 + perSample rows, labels preserved', () => {
    const rand = mulberry32(3);
    const rows = [
      { label: '0', vec: normalizeHand(fingersUp(1))! },
      { label: '1', vec: normalizeHand(fingersUp(2))! },
    ];
    const out = augmentDataset(rows, 5, rand);
    expect(out).toHaveLength(2 * (1 + 5));
    expect(out.filter((r) => r.label === '0')).toHaveLength(6);
    // first row of each label is the untouched original
    expect(out[0]!.vec).toEqual(rows[0]!.vec);
  });
});
