import { describe, it, expect } from 'vitest';
import { trainHandMlp, predictHandMlp, serializeHandMlp, deserializeHandMlp } from './handModel';
import { augmentVec } from './handAugment';
import { mulberry32 } from './rng';
import { normalizeHand } from './handTemplate';
import { fingersUp, synthHand } from './synthetic';

/** ~12 enrolled samples per label 0..5, like a real calibration session. */
function enrolled(seed = 7) {
  const rand = mulberry32(seed);
  const rows: { label: string; vec: number[] }[] = [];
  for (let n = 0; n <= 5; n++) {
    const base = normalizeHand(n === 0 ? synthHand({}) : fingersUp(n as 1 | 2 | 3 | 4 | 5))!;
    for (let k = 0; k < 12; k++) {
      rows.push({ label: String(n), vec: augmentVec(base, rand, { jitter: 0.01, rotDeg: 6, scale: 0.04 }) });
    }
  }
  return rows;
}

describe('trainHandMlp', () => {
  it('learns to separate the 6 poses (high train accuracy, low loss)', async () => {
    const { model, trainAccuracy, finalLoss } = await trainHandMlp(enrolled(), { epochs: 150, seed: 1 });
    expect(model.labels).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(trainAccuracy).toBeGreaterThan(0.9);
    expect(finalLoss).toBeLessThan(0.5);
  });

  it('generalizes to held-out samples of the same poses', async () => {
    const { model } = await trainHandMlp(enrolled(7), { epochs: 150, seed: 1 });
    const testRand = mulberry32(999);
    let ok = 0;
    let total = 0;
    for (let n = 0; n <= 5; n++) {
      const base = normalizeHand(n === 0 ? synthHand({}) : fingersUp(n as 1 | 2 | 3 | 4 | 5))!;
      for (let k = 0; k < 8; k++) {
        const v = augmentVec(base, testRand, { jitter: 0.012, rotDeg: 8, scale: 0.05 });
        const p = predictHandMlp(model, v)!;
        if (p.label === String(n)) ok++;
        total++;
      }
    }
    expect(ok / total).toBeGreaterThan(0.85);
  });

  it('is less confident on a hand halfway between two taught poses', async () => {
    // (a plain softmax MLP is overconfident on true garbage — that case is
    //  gated upstream by normalizeHand + the k-NN distance check in
    //  web/calibration.ts. Here we check the useful in-distribution signal.)
    const { model } = await trainHandMlp(enrolled(), { epochs: 150, seed: 1 });
    const two = normalizeHand(fingersUp(2))!;
    const three = normalizeHand(fingersUp(3))!;
    const clean = predictHandMlp(model, three)!;
    const blend = two.map((v, i) => (v + three[i]!) / 2);
    const ambiguous = predictHandMlp(model, blend)!;
    expect(clean.confidence).toBeGreaterThan(0.8);
    expect(ambiguous.confidence).toBeLessThan(clean.confidence);
  });

  it('is deterministic given a seed', async () => {
    const a = await trainHandMlp(enrolled(3), { epochs: 40, seed: 5 });
    const b = await trainHandMlp(enrolled(3), { epochs: 40, seed: 5 });
    expect(a.finalLoss).toBe(b.finalLoss);
    expect(a.model.W1[0]![0]).toBe(b.model.W1[0]![0]);
  });

  it('serialize / deserialize round-trips and predicts identically', async () => {
    const { model } = await trainHandMlp(enrolled(), { epochs: 60, seed: 1 });
    const restored = deserializeHandMlp(serializeHandMlp(model))!;
    const v = normalizeHand(fingersUp(3))!;
    expect(predictHandMlp(restored, v)).toEqual(predictHandMlp(model, v));
  });

  it('rejects too-few samples', async () => {
    await expect(trainHandMlp([{ label: '0', vec: new Array(42).fill(0) }])).rejects.toThrow();
  });

  it('onProgress is called and may be async', async () => {
    const seen: number[] = [];
    await trainHandMlp(enrolled(), {
      epochs: 30,
      seed: 1,
      onProgress: async (e) => {
        seen.push(e);
      },
    });
    expect(seen[0]).toBe(0);
    expect(seen.length).toBeGreaterThan(1);
  });
});
