import { gaussian } from './rng';

/**
 * Data augmentation for normalized hand vectors (42 = 21 landmarks x,y, wrist at
 * origin). ~72 real samples is far too few to train an MLP, so each sample is
 * expanded into several synthetic variants that stay the same pose but differ in
 * the ways a webcam actually varies: small rotation, small scale, per-point
 * jitter.
 */

export interface AugmentOpts {
  /** per-coordinate gaussian noise stdev (normalized units). */
  jitter: number;
  /** max absolute rotation about the wrist, degrees. */
  rotDeg: number;
  /** max absolute isotropic scale delta (0.06 = ±6%). */
  scale: number;
}

export const DEFAULT_AUGMENT: AugmentOpts = { jitter: 0.014, rotDeg: 12, scale: 0.06 };

export function augmentVec(vec: number[], rand: () => number, opts: AugmentOpts = DEFAULT_AUGMENT): number[] {
  const th = ((rand() * 2 - 1) * opts.rotDeg * Math.PI) / 180;
  const k = 1 + (rand() * 2 - 1) * opts.scale;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const out = new Array<number>(vec.length);
  for (let i = 0; i < vec.length; i += 2) {
    const x = vec[i]!;
    const y = vec[i + 1]!;
    out[i] = (x * c - y * s) * k + gaussian(rand) * opts.jitter;
    out[i + 1] = (x * s + y * c) * k + gaussian(rand) * opts.jitter;
  }
  return out;
}

/** Expand each labelled sample into `perSample` augmented copies (originals kept). */
export function augmentDataset(
  samples: { label: string; vec: number[] }[],
  perSample: number,
  rand: () => number,
  opts: AugmentOpts = DEFAULT_AUGMENT,
): { label: string; vec: number[] }[] {
  const out: { label: string; vec: number[] }[] = [];
  for (const s of samples) {
    out.push({ label: s.label, vec: s.vec.slice() });
    for (let i = 0; i < perSample; i++) out.push({ label: s.label, vec: augmentVec(s.vec, rand, opts) });
  }
  return out;
}
