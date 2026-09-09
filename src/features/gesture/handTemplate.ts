import type { HandObservation } from './fingerCounting';

/**
 * Per-user hand-shape learning: the user records a few samples of each pose they
 * care about (fist / 1..5 fingers / a custom pose), and recognition then works
 * by nearest-neighbour match against THOSE samples instead of fixed finger-angle
 * heuristics. More robust to hand size, finger length, camera angle, and to
 * "half-curled" fingers that trip a threshold.
 *
 * A sample is a 42-dim vector: the 21 landmarks, made invariant to
 *   - position  (translate wrist -> origin)
 *   - scale     (divide by |wrist -> middle-finger MCP|)
 *   - handedness(mirror Left to Right, so one template covers both hands)
 * z is dropped — depth from a single webcam is noisy and hurts more than helps.
 *
 * Pure & framework-free; used by the web demo's calibration flow.
 */

const WRIST = 0;
const MIDDLE_MCP = 9;

export function normalizeHand(obs: HandObservation): number[] | null {
  const lm = obs?.landmarks;
  if (!lm || lm.length !== 21) return null;
  const w = lm[WRIST]!;
  const m = lm[MIDDLE_MCP]!;
  const scale = Math.hypot(m.x - w.x, m.y - w.y);
  if (!(scale > 1e-4) || !Number.isFinite(scale)) return null;
  const mirror = obs.handedness === 'Left' ? -1 : 1;
  const out: number[] = [];
  for (const p of lm) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    out.push(((p.x - w.x) * mirror) / scale, (p.y - w.y) / scale);
  }
  return out;
}

export interface TemplateSet {
  version: number;
  /** label -> list of normalized samples */
  labels: Record<string, number[][]>;
}

export function emptyTemplateSet(): TemplateSet {
  return { version: 1, labels: {} };
}

export function addSample(set: TemplateSet, label: string, obs: HandObservation): boolean {
  const v = normalizeHand(obs);
  if (!v) return false;
  (set.labels[label] ??= []).push(v);
  return true;
}

export function sampleCount(set: TemplateSet, label: string): number {
  return set.labels[label]?.length ?? 0;
}

/** All listed labels have at least `minSamples` samples. */
export function isCalibrated(set: TemplateSet, labels: string[], minSamples = 3): boolean {
  return labels.every((l) => sampleCount(set, l) >= minSamples);
}

export interface ClassifyResult {
  label: string;
  /** RMS per-coordinate distance to the nearest sample (smaller = better). */
  distance: number;
  /** rough 0..1 confidence derived from the distance + margin to the runner-up. */
  confidence: number;
}

function rms(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i]! - b[i]!;
    s += d * d;
  }
  return Math.sqrt(s / a.length);
}

/**
 * k-NN (k=1) over every stored sample. Returns null when nothing is within
 * `maxDistance` (i.e. the pose doesn't match anything the user taught).
 */
export function classifyHand(
  set: TemplateSet,
  obs: HandObservation,
  maxDistance = 0.62,
): ClassifyResult | null {
  const v = normalizeHand(obs);
  if (!v) return null;

  let bestLabel = '';
  let best = Infinity;
  let secondBestOther = Infinity; // best distance among a DIFFERENT label
  for (const [label, samples] of Object.entries(set.labels)) {
    for (const s of samples) {
      if (s.length !== v.length) continue;
      const d = rms(v, s);
      if (d < best) {
        if (label !== bestLabel) secondBestOther = best === Infinity ? secondBestOther : best;
        best = d;
        bestLabel = label;
      } else if (label !== bestLabel && d < secondBestOther) {
        secondBestOther = d;
      }
    }
  }

  if (!bestLabel || best > maxDistance) return null;
  const margin = Number.isFinite(secondBestOther) ? Math.max(0, secondBestOther - best) : maxDistance;
  const confidence = clamp01(0.5 * (1 - best / maxDistance) + 0.5 * Math.min(1, margin / (maxDistance * 0.5)));
  return { label: bestLabel, distance: best, confidence };
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
