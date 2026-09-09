/**
 * HoldGate — the misrecognition-prevention core, factored out so both the
 * one-shot `GestureController` burst and the always-on `gestureWatch` loop use
 * identical rules:
 *
 *   - a signal must be seen in >= `framesForConfirm` consecutive usable frames
 *   - ...AND held stable for >= `holdDurationMs`
 *   - after a confirm, ignore everything for `cooldownMs`
 *   - right after a confirm, ignore a *different* signal for
 *     `distinctGestureDebounceMs` (anti-flicker)
 *
 * Pure and time-injected: you feed it `(signal, nowMs)` and it tells you when a
 * gesture is confirmed. `signal` is whatever discrete value you want to confirm
 * (e.g. a finger count, or 1 for "open palm" / "fist").
 */

export interface HoldGateConfig {
  framesForConfirm: number;
  holdDurationMs: number;
  cooldownMs: number;
  distinctGestureDebounceMs: number;
}

export interface HoldGateResult {
  confirmed: boolean;
  signal?: number;
  /** frames the current candidate has been agreed on (for UI progress). */
  progressFrames: number;
  inCooldown: boolean;
}

export class HoldGate {
  private candidate: { signal: number; since: number; agree: number } | null = null;
  private lastConfirmed: { signal: number; at: number } | null = null;
  private cooldownUntil = 0;

  constructor(private readonly cfg: HoldGateConfig) {}

  reset(): void {
    this.candidate = null;
  }

  /** Full reset including cooldown/last-confirmed (e.g. when the target changes). */
  hardReset(): void {
    this.candidate = null;
    this.lastConfirmed = null;
    this.cooldownUntil = 0;
  }

  isCoolingDown(now: number): boolean {
    return now < this.cooldownUntil;
  }

  /** `signal === null` means "no usable hand this frame" — breaks the streak. */
  feed(signal: number | null, now: number): HoldGateResult {
    if (now < this.cooldownUntil) {
      return { confirmed: false, progressFrames: 0, inCooldown: true };
    }
    if (signal == null) {
      this.candidate = null;
      return { confirmed: false, progressFrames: 0, inCooldown: false };
    }

    // anti-flicker: right after a confirm, ignore a DIFFERENT signal briefly
    if (
      this.lastConfirmed &&
      signal !== this.lastConfirmed.signal &&
      now - this.lastConfirmed.at < this.cfg.distinctGestureDebounceMs
    ) {
      return { confirmed: false, progressFrames: 0, inCooldown: false };
    }

    if (this.candidate && this.candidate.signal === signal) {
      this.candidate.agree += 1;
    } else {
      this.candidate = { signal, since: now, agree: 1 };
    }

    const held = now - this.candidate.since;
    if (this.candidate.agree >= this.cfg.framesForConfirm && held >= this.cfg.holdDurationMs) {
      this.lastConfirmed = { signal, at: now };
      this.cooldownUntil = now + this.cfg.cooldownMs;
      const confirmedSignal = signal;
      this.candidate = null;
      return { confirmed: true, signal: confirmedSignal, progressFrames: this.cfg.framesForConfirm, inCooldown: false };
    }

    return { confirmed: false, signal, progressFrames: this.candidate.agree, inCooldown: false };
  }
}
