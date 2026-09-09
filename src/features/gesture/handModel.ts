import { mulberry32, gaussian } from './rng';
import { augmentDataset } from './handAugment';

/**
 * A tiny hand-shape classifier MLP, trained IN THE BROWSER on the user's own
 * enrolled samples (no TensorFlow, no server, no dataset).
 *
 *   input 42  ->  dense(h) + ReLU  ->  dense(C) + softmax
 *
 * Full-batch gradient descent with momentum + L2, on the enrolled samples
 * expanded by augmentation. ~200 epochs over ~600 rows is a fraction of a
 * second. Pure & deterministic given a seed, so it unit-tests like everything
 * else in this folder.
 */

export interface HandMlp {
  version: 1;
  labels: string[]; // class order
  h: number;
  mean: number[]; // 42
  std: number[]; // 42
  W1: number[][]; // 42 x h
  b1: number[]; // h
  W2: number[][]; // h x C
  b2: number[]; // C
}

export interface TrainOpts {
  hidden?: number;
  epochs?: number;
  lr?: number;
  l2?: number;
  momentum?: number;
  augPerSample?: number;
  seed?: number;
  /** called every ~10 epochs with (epoch, loss); may await to yield the UI thread. */
  onProgress?: (epoch: number, loss: number) => void | Promise<void>;
}

export interface TrainResult {
  model: HandMlp;
  finalLoss: number;
  trainAccuracy: number;
  epochs: number;
}

const INPUT = 42;

export async function trainHandMlp(
  samples: { label: string; vec: number[] }[],
  opts: TrainOpts = {},
): Promise<TrainResult> {
  const hidden = opts.hidden ?? 24;
  const epochs = opts.epochs ?? 200;
  const lr = opts.lr ?? 0.08;
  const l2 = opts.l2 ?? 2e-4;
  const mu = opts.momentum ?? 0.9;
  const augPerSample = opts.augPerSample ?? 8;
  const rand = mulberry32(opts.seed ?? 1);

  const clean = samples.filter((s) => s.vec.length === INPUT && s.vec.every(Number.isFinite));
  if (clean.length < 6) throw new Error('not enough samples to train');

  const labels = [...new Set(clean.map((s) => s.label))].sort();
  const C = labels.length;
  const labelIndex = new Map(labels.map((l, i) => [l, i]));

  // build + augment dataset
  const rows = augmentDataset(clean, augPerSample, rand);
  const N = rows.length;
  const X = rows.map((r) => r.vec.slice());
  const y = rows.map((r) => labelIndex.get(r.label)!);

  // standardize features
  const mean = new Array<number>(INPUT).fill(0);
  const std = new Array<number>(INPUT).fill(0);
  for (const row of X) for (let j = 0; j < INPUT; j++) mean[j]! += row[j]! / N;
  for (const row of X) for (let j = 0; j < INPUT; j++) std[j]! += (row[j]! - mean[j]!) ** 2 / N;
  for (let j = 0; j < INPUT; j++) std[j]! = Math.sqrt(std[j]!) || 1;
  for (const row of X) for (let j = 0; j < INPUT; j++) row[j] = (row[j]! - mean[j]!) / std[j]!;

  // He init
  const W1 = randMat(INPUT, hidden, Math.sqrt(2 / INPUT), rand);
  const b1 = new Array<number>(hidden).fill(0);
  const W2 = randMat(hidden, C, Math.sqrt(2 / hidden), rand);
  const b2 = new Array<number>(C).fill(0);
  const vW1 = zeros(INPUT, hidden);
  const vb1 = new Array<number>(hidden).fill(0);
  const vW2 = zeros(hidden, C);
  const vb2 = new Array<number>(C).fill(0);

  let loss = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    // forward (full batch)
    const A1 = zeros(N, hidden);
    const Z1 = zeros(N, hidden);
    const P = zeros(N, C);
    loss = 0;
    for (let i = 0; i < N; i++) {
      const xi = X[i]!;
      for (let k = 0; k < hidden; k++) {
        let z = b1[k]!;
        for (let j = 0; j < INPUT; j++) z += xi[j]! * W1[j]![k]!;
        Z1[i]![k] = z;
        A1[i]![k] = z > 0 ? z : 0;
      }
      let maxZ = -Infinity;
      const z2 = new Array<number>(C);
      for (let c = 0; c < C; c++) {
        let z = b2[c]!;
        for (let k = 0; k < hidden; k++) z += A1[i]![k]! * W2[k]![c]!;
        z2[c] = z;
        if (z > maxZ) maxZ = z;
      }
      let sum = 0;
      for (let c = 0; c < C; c++) {
        const e = Math.exp(z2[c]! - maxZ);
        P[i]![c] = e;
        sum += e;
      }
      for (let c = 0; c < C; c++) P[i]![c]! /= sum;
      loss += -Math.log(Math.max(1e-12, P[i]![y[i]!]!)) / N;
    }

    // backward
    const gW1 = zeros(INPUT, hidden);
    const gb1 = new Array<number>(hidden).fill(0);
    const gW2 = zeros(hidden, C);
    const gb2 = new Array<number>(C).fill(0);
    for (let i = 0; i < N; i++) {
      const dZ2 = new Array<number>(C);
      for (let c = 0; c < C; c++) dZ2[c] = (P[i]![c]! - (c === y[i]! ? 1 : 0)) / N;
      for (let c = 0; c < C; c++) {
        gb2[c]! += dZ2[c]!;
        for (let k = 0; k < hidden; k++) gW2[k]![c]! += A1[i]![k]! * dZ2[c]!;
      }
      const dA1 = new Array<number>(hidden).fill(0);
      for (let k = 0; k < hidden; k++) {
        let g = 0;
        for (let c = 0; c < C; c++) g += dZ2[c]! * W2[k]![c]!;
        dA1[k] = Z1[i]![k]! > 0 ? g : 0;
      }
      for (let k = 0; k < hidden; k++) {
        gb1[k]! += dA1[k]!;
        const xi = X[i]!;
        for (let j = 0; j < INPUT; j++) gW1[j]![k]! += xi[j]! * dA1[k]!;
      }
    }

    // momentum + L2 update
    for (let j = 0; j < INPUT; j++)
      for (let k = 0; k < hidden; k++) {
        const g = gW1[j]![k]! + l2 * W1[j]![k]!;
        vW1[j]![k] = mu * vW1[j]![k]! - lr * g;
        W1[j]![k]! += vW1[j]![k]!;
      }
    for (let k = 0; k < hidden; k++) {
      vb1[k] = mu * vb1[k]! - lr * gb1[k]!;
      b1[k]! += vb1[k]!;
    }
    for (let k = 0; k < hidden; k++)
      for (let c = 0; c < C; c++) {
        const g = gW2[k]![c]! + l2 * W2[k]![c]!;
        vW2[k]![c] = mu * vW2[k]![c]! - lr * g;
        W2[k]![c]! += vW2[k]![c]!;
      }
    for (let c = 0; c < C; c++) {
      vb2[c] = mu * vb2[c]! - lr * gb2[c]!;
      b2[c]! += vb2[c]!;
    }

    if (epoch % 10 === 0 || epoch === epochs - 1) {
      const maybe = opts.onProgress?.(epoch, loss);
      if (maybe && typeof (maybe as Promise<void>).then === 'function') await maybe;
    }
  }

  const model: HandMlp = { version: 1, labels, h: hidden, mean, std, W1, b1, W2, b2 };
  const trainAccuracy = accuracy(model, rows);
  return { model, finalLoss: loss, trainAccuracy, epochs };
}

export interface Prediction {
  label: string;
  index: number;
  probs: number[];
  confidence: number; // max softmax probability
  margin: number; // top1 - top2
}

export function predictHandMlp(model: HandMlp, vec: number[]): Prediction | null {
  if (vec.length !== INPUT || !vec.every(Number.isFinite)) return null;
  const x = new Array<number>(INPUT);
  for (let j = 0; j < INPUT; j++) x[j] = (vec[j]! - model.mean[j]!) / model.std[j]!;
  const a1 = new Array<number>(model.h);
  for (let k = 0; k < model.h; k++) {
    let z = model.b1[k]!;
    for (let j = 0; j < INPUT; j++) z += x[j]! * model.W1[j]![k]!;
    a1[k] = z > 0 ? z : 0;
  }
  const C = model.labels.length;
  const z2 = new Array<number>(C);
  let maxZ = -Infinity;
  for (let c = 0; c < C; c++) {
    let z = model.b2[c]!;
    for (let k = 0; k < model.h; k++) z += a1[k]! * model.W2[k]![c]!;
    z2[c] = z;
    if (z > maxZ) maxZ = z;
  }
  let sum = 0;
  const probs = new Array<number>(C);
  for (let c = 0; c < C; c++) {
    const e = Math.exp(z2[c]! - maxZ);
    probs[c] = e;
    sum += e;
  }
  let top = 0;
  let second = 0;
  let ti = 0;
  for (let c = 0; c < C; c++) {
    probs[c]! /= sum;
    if (probs[c]! > top) {
      second = top;
      top = probs[c]!;
      ti = c;
    } else if (probs[c]! > second) {
      second = probs[c]!;
    }
  }
  return { label: model.labels[ti]!, index: ti, probs, confidence: top, margin: top - second };
}

export function serializeHandMlp(m: HandMlp): string {
  return JSON.stringify(m);
}
export function deserializeHandMlp(s: string): HandMlp | null {
  try {
    const m = JSON.parse(s) as HandMlp;
    if (m && m.version === 1 && Array.isArray(m.labels) && Array.isArray(m.W1)) return m;
  } catch {
    /* ignore */
  }
  return null;
}

function accuracy(model: HandMlp, rows: { label: string; vec: number[] }[]): number {
  let ok = 0;
  for (const r of rows) {
    const p = predictHandMlp(model, r.vec);
    if (p && p.label === r.label) ok++;
  }
  return rows.length ? ok / rows.length : 0;
}

function randMat(rows: number, cols: number, scale: number, rand: () => number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const r = new Array<number>(cols);
    for (let j = 0; j < cols; j++) r[j] = gaussian(rand) * scale;
    m.push(r);
  }
  return m;
}
function zeros(rows: number, cols: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < rows; i++) m.push(new Array<number>(cols).fill(0));
  return m;
}
