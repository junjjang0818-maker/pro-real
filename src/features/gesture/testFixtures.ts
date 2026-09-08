import type { HandObservation, Landmark } from './fingerCounting';

type FingerName = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export interface SynthOptions {
  presence?: number;
  handedness?: 'Left' | 'Right';
  /** 1 => handSpan ~0.30 (well above the min). 0.3 => too small. */
  scale?: number;
  /** shift the whole hand horizontally; large values push landmarks off-frame. */
  offsetX?: number;
}

/**
 * Build a plausible 21-point hand where the named fingers are extended.
 * Geometry is deliberately simple (upright hand, palm to camera) — enough to
 * exercise `countExtendedFingers` deterministically without real ML output.
 */
export function synthHand(
  up: Partial<Record<FingerName, boolean>>,
  opts: SynthOptions = {},
): HandObservation {
  const presence = opts.presence ?? 0.95;
  const handedness = opts.handedness ?? 'Right';
  const s = opts.scale ?? 1;
  const ox = opts.offsetX ?? 0;
  const P = (x: number, y: number): Landmark => ({
    x: 0.5 + (x - 0.5) * s + ox,
    y: 0.9 + (y - 0.9) * s,
    z: 0,
  });

  const L: Landmark[] = Array.from({ length: 21 }, () => P(0.5, 0.9));

  L[0] = P(0.5, 0.9); // wrist

  // index (x 0.40), middle (0.50), ring (0.60), pinky (0.68)
  const col: Record<Exclude<FingerName, 'thumb'>, { mcp: number; x: number }> = {
    index: { mcp: 5, x: 0.4 },
    middle: { mcp: 9, x: 0.5 },
    ring: { mcp: 13, x: 0.6 },
    pinky: { mcp: 17, x: 0.68 },
  };
  for (const name of ['index', 'middle', 'ring', 'pinky'] as const) {
    const { mcp, x } = col[name];
    const extended = !!up[name];
    L[mcp] = P(x, 0.6);
    L[mcp + 1] = P(x, extended ? 0.45 : 0.56); // pip
    L[mcp + 2] = P(x, extended ? 0.4 : 0.58); // dip
    L[mcp + 3] = P(x, extended ? 0.33 : 0.63); // tip
  }

  // thumb chain
  L[1] = P(0.42, 0.8);
  L[2] = P(0.39, 0.74);
  L[3] = P(0.36, 0.7);
  const extendedThumbX = handedness === 'Right' ? 0.26 : 0.74;
  const curledThumbX = handedness === 'Right' ? 0.42 : 0.44;
  L[4] = P(up.thumb ? extendedThumbX : curledThumbX, up.thumb ? 0.64 : 0.67);

  return { landmarks: L, handedness, presence };
}

export function fingersUp(n: 0 | 1 | 2 | 3 | 4 | 5, handedness: 'Left' | 'Right' = 'Right'): HandObservation {
  // Natural counting: 1=index, 2=index+middle, 3=+ring, 4=+pinky, 5=+thumb
  const order: FingerName[] = ['index', 'middle', 'ring', 'pinky', 'thumb'];
  const up: Partial<Record<FingerName, boolean>> = {};
  for (let i = 0; i < n; i++) up[order[i]!] = true;
  return synthHand(up, { handedness });
}
