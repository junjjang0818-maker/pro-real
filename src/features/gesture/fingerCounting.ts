/**
 * Landmark -> extended-finger count. Pure, no ML training.
 *
 * MediaPipe Hand Landmarker gives 21 normalized points per hand (x right,
 * y DOWN, origin top-left, values ~0..1). Index map:
 *   0 wrist
 *   1-4   thumb  (CMC, MCP, IP, TIP)
 *   5-8   index  (MCP, PIP, DIP, TIP)
 *   9-12  middle
 *   13-16 ring
 *   17-20 pinky
 *
 * Heuristic (hand roughly upright, palm/back toward camera):
 *   - a non-thumb finger is "extended" when its TIP is clearly ABOVE (smaller y)
 *     its PIP joint AND its MCP, by a margin scaled to hand size.
 *   - the thumb is "extended" when its TIP is far from the hand's centre line
 *     on the lateral axis (direction depends on Left/Right handedness).
 *
 * `usable` gates out inputs we shouldn't classify at all: low model presence,
 * a hand too small/far, or landmarks off-frame. The GestureController ignores
 * unusable frames entirely (part of 오인식 방지).
 */

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandObservation {
  landmarks: Landmark[]; // length 21
  handedness: 'Left' | 'Right';
  /** model confidence that a hand is present, 0..1. */
  presence: number;
}

export interface FingerCountConfig {
  minPresence: number; // e.g. 0.7
  minHandSpan: number; // normalized wrist->middle-MCP distance, e.g. 0.12
  extendMargin: number; // fraction of hand span, e.g. 0.15
}

export const DEFAULT_FINGER_CONFIG: FingerCountConfig = {
  minPresence: 0.7,
  minHandSpan: 0.12,
  extendMargin: 0.15,
};

export type FiveBool = [boolean, boolean, boolean, boolean, boolean];

export interface FingerCountResult {
  count: 0 | 1 | 2 | 3 | 4 | 5;
  perFinger: FiveBool; // thumb, index, middle, ring, pinky
  handSpan: number;
  usable: boolean;
  reason?: 'low-presence' | 'hand-too-small' | 'off-frame' | 'bad-landmarks';
}

const WRIST = 0;
const TIPS = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 } as const;
const PIPS = { index: 6, middle: 10, ring: 14, pinky: 18 } as const;
const MCPS = { index: 5, middle: 9, ring: 13, pinky: 17 } as const;

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function countExtendedFingers(
  obs: HandObservation,
  cfg: FingerCountConfig = DEFAULT_FINGER_CONFIG,
): FingerCountResult {
  const zero: FiveBool = [false, false, false, false, false];

  if (!obs.landmarks || obs.landmarks.length !== 21 || obs.landmarks.some((l) => !isFinite(l.x) || !isFinite(l.y))) {
    return { count: 0, perFinger: zero, handSpan: 0, usable: false, reason: 'bad-landmarks' };
  }
  if (obs.presence < cfg.minPresence) {
    return { count: 0, perFinger: zero, handSpan: 0, usable: false, reason: 'low-presence' };
  }

  const lm = obs.landmarks;
  const wrist = lm[WRIST]!;
  const midMcp = lm[MCPS.middle]!;
  const handSpan = dist(wrist, midMcp);

  if (handSpan < cfg.minHandSpan) {
    return { count: 0, perFinger: zero, handSpan, usable: false, reason: 'hand-too-small' };
  }
  const offFrame = lm.some((l) => l.x < -0.05 || l.x > 1.05 || l.y < -0.05 || l.y > 1.05);
  if (offFrame) {
    return { count: 0, perFinger: zero, handSpan, usable: false, reason: 'off-frame' };
  }

  const margin = handSpan * cfg.extendMargin;

  const fingerExtended = (tip: number, pip: number, mcp: number): boolean => {
    const t = lm[tip]!;
    const p = lm[pip]!;
    const m = lm[mcp]!;
    // y grows downward: extended => tip is higher on screen than pip and mcp
    return t.y < p.y - margin && t.y < m.y;
  };

  const index = fingerExtended(TIPS.index, PIPS.index, MCPS.index);
  const middle = fingerExtended(TIPS.middle, PIPS.middle, MCPS.middle);
  const ring = fingerExtended(TIPS.ring, PIPS.ring, MCPS.ring);
  const pinky = fingerExtended(TIPS.pinky, PIPS.pinky, MCPS.pinky);

  // Thumb: lateral distance of TIP from the index MCP, relative to hand span.
  // For a Right hand the extended thumb points to smaller x; Left -> larger x.
  const thumbTip = lm[TIPS.thumb]!;
  const indexMcp = lm[MCPS.index]!;
  const lateral = thumbTip.x - indexMcp.x;
  const thumb =
    obs.handedness === 'Right'
      ? lateral < -margin * 1.2
      : lateral > margin * 1.2;

  const perFinger: FiveBool = [thumb, index, middle, ring, pinky];
  const count = perFinger.filter(Boolean).length as FingerCountResult['count'];
  return { count, perFinger, handSpan, usable: true };
}
