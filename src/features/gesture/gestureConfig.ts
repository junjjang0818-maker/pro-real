/**
 * Every knob the brief asks to be tunable for 오인식 방지 (misrecognition
 * prevention) lives here. Ship conservative defaults; expose in a debug screen.
 */
export interface GestureConfig {
  /** model presence floor, forwarded to finger counting. */
  minConfidence: number;
  minHandSpan: number;
  extendMargin: number;

  /** a candidate gesture must stay stable at least this long. */
  holdDurationMs: number;
  /** ...AND be seen in at least this many consecutive usable frames. */
  framesForConfirm: number;

  /** after a confirmed recognition, ignore new attempts for this long. */
  cooldownMs: number;
  /** abandon the attempt (fall back to buttons) if nothing confirms in this window. */
  maxBurstMs: number;

  /** the camera must deliver its first frame within this, or we treat it as throttled. */
  armingTimeoutMs: number;
  /** sustained delivered FPS below this ⇒ treat as OS/thermal throttling. */
  minAcceptableFps: number;

  /** right after a confirm, ignore a *different* count for this long (anti-flicker). */
  distinctGestureDebounceMs: number;

  /** count threshold that means "open palm" (start) vs "fist" (stop). */
  openPalmMinFingers: number;
}

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
  minConfidence: 0.7,
  minHandSpan: 0.12,
  extendMargin: 0.15,
  holdDurationMs: 600,
  framesForConfirm: 6,
  cooldownMs: 2_500,
  maxBurstMs: 4_000,
  armingTimeoutMs: 1_200,
  minAcceptableFps: 8,
  distinctGestureDebounceMs: 1_200,
  openPalmMinFingers: 4,
};
