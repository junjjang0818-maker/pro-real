import { countExtendedFingers, type HandObservation } from './fingerCounting';
import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from './gestureConfig';

/**
 * GestureController — drives ONE short recognition burst and resolves with
 * either a confirmed gesture or a fallback reason. It never throws and never
 * hangs: every path resolves, so the UI can always fall back to buttons.
 *
 * Camera is only on during an `attempt()` (arming -> a few seconds -> off),
 * never streaming continuously (battery).
 *
 * It knows nothing about sessions. The caller turns a confirmed result into an
 * `InputIntent` and puts it on the InputBus — same path as a button press.
 */

export interface SystemSignal {
  lowPower: boolean;
  thermal: 'nominal' | 'fair' | 'serious' | 'critical';
  deliveredFps: number;
}

export interface CameraSource {
  /** may reject: 'permission' | 'no-camera' | 'error' (message-classified). */
  start(): Promise<void>;
  stop(): void;
  onFrame(cb: (obs: HandObservation | null) => void): () => void;
  onSystemSignal(cb: (s: SystemSignal) => void): () => void;
}

export interface ControllerDeps {
  camera: CameraSource;
  now: () => number;
  /** schedule a callback; returns a cancel fn. Injectable for tests. */
  schedule: (ms: number, fn: () => void) => () => void;
  config?: GestureConfig;
  onStateChange?: (state: GestureState) => void;
}

export type GestureState =
  | 'idle'
  | 'arming'
  | 'detecting'
  | 'confirmed'
  | 'cooldown'
  | 'unavailable';

export type AttemptKind = 'start' | 'stop' | 'count';

export type FallbackReason =
  | 'permission'
  | 'no-camera'
  | 'degraded' // OS/thermal/low-power throttling or camera not delivering
  | 'timeout' // arming timed out
  | 'no-gesture' // burst elapsed with nothing confirmed
  | 'cooldown'
  | 'error';

export interface AttemptResult {
  outcome: 'confirmed' | 'fallback';
  /** for 'count' attempts: the recognized finger count (1..5). */
  value?: number;
  confidence?: number;
  fallbackReason?: FallbackReason;
}

interface Candidate {
  signal: number; // the value we're trying to confirm (see signalFor)
  since: number;
  agree: number;
}

export class GestureController {
  private readonly cfg: GestureConfig;
  private state: GestureState = 'idle';
  private cooldownUntil = 0;
  private degradedLatched = false;

  // per-attempt scratch
  private active = false;
  private candidate: Candidate | null = null;
  private lastConfirmed: { signal: number; at: number } | null = null;
  private frameTimestamps: number[] = [];
  private cleanups: Array<() => void> = [];
  private resolveAttempt: ((r: AttemptResult) => void) | null = null;

  constructor(private readonly deps: ControllerDeps) {
    this.cfg = deps.config ?? DEFAULT_GESTURE_CONFIG;
  }

  getState(): GestureState {
    return this.state;
  }

  isDegraded(): boolean {
    return this.degradedLatched;
  }

  /** Manually clear the degraded latch (e.g. user retried while charging). */
  clearDegraded(): void {
    this.degradedLatched = false;
    if (this.state === 'unavailable' && !this.active) this.setState('idle');
  }

  /** Feed a system signal at any time (Low Power Mode / thermalState / FPS). */
  pushSystemSignal(s: SystemSignal): void {
    if (this.isThrottling(s)) {
      this.degradedLatched = true;
      if (this.active) this.finish({ outcome: 'fallback', fallbackReason: 'degraded' });
    }
  }

  async attempt(kind: AttemptKind): Promise<AttemptResult> {
    const now = this.deps.now();

    if (now < this.cooldownUntil) {
      return { outcome: 'fallback', fallbackReason: 'cooldown' };
    }
    if (this.degradedLatched) {
      return { outcome: 'fallback', fallbackReason: 'degraded' };
    }
    if (this.active) {
      // one burst at a time
      return { outcome: 'fallback', fallbackReason: 'error' };
    }

    this.active = true;
    this.candidate = null;
    this.frameTimestamps = [];
    this.setState('arming');

    return new Promise<AttemptResult>((resolve) => {
      this.resolveAttempt = resolve;

      // arming timeout — camera didn't deliver a frame -> treat as throttled
      let armed = false;
      this.cleanups.push(
        this.deps.schedule(this.cfg.armingTimeoutMs, () => {
          if (!armed) this.finish({ outcome: 'fallback', fallbackReason: 'timeout' });
        }),
      );
      // overall burst budget
      this.cleanups.push(
        this.deps.schedule(this.cfg.maxBurstMs, () => {
          this.finish({ outcome: 'fallback', fallbackReason: 'no-gesture' });
        }),
      );

      this.cleanups.push(
        this.deps.camera.onSystemSignal((s) => this.pushSystemSignal(s)),
      );
      this.cleanups.push(
        this.deps.camera.onFrame((obs) => {
          armed = true;
          if (this.state === 'arming') this.setState('detecting');
          this.onFrame(kind, obs);
        }),
      );

      this.deps.camera.start().catch((err: unknown) => {
        this.finish({
          outcome: 'fallback',
          fallbackReason: classifyStartError(err),
        });
      });
    });
  }

  private onFrame(kind: AttemptKind, obs: HandObservation | null): void {
    if (!this.active) return;
    const now = this.deps.now();

    // FPS watchdog — sustained low delivery => throttling
    this.frameTimestamps.push(now);
    if (this.frameTimestamps.length > 10) this.frameTimestamps.shift();
    if (this.frameTimestamps.length >= 4) {
      const span = now - this.frameTimestamps[0]!;
      const fps = span > 0 ? ((this.frameTimestamps.length - 1) * 1000) / span : Infinity;
      if (fps < this.cfg.minAcceptableFps) {
        this.degradedLatched = true;
        this.finish({ outcome: 'fallback', fallbackReason: 'degraded' });
        return;
      }
    }

    if (obs == null) {
      this.candidate = null;
      return;
    }

    const fc = countExtendedFingers(obs, {
      minPresence: this.cfg.minConfidence,
      minHandSpan: this.cfg.minHandSpan,
      extendMargin: this.cfg.extendMargin,
    });
    if (!fc.usable) {
      this.candidate = null; // unusable frame breaks the streak
      return;
    }

    const signal = this.signalFor(kind, fc.count);
    if (signal == null) {
      this.candidate = null;
      return;
    }

    // anti-flicker: right after a confirm, ignore a DIFFERENT signal briefly
    if (
      this.lastConfirmed &&
      signal !== this.lastConfirmed.signal &&
      now - this.lastConfirmed.at < this.cfg.distinctGestureDebounceMs
    ) {
      return;
    }

    if (this.candidate && this.candidate.signal === signal) {
      this.candidate.agree += 1;
    } else {
      this.candidate = { signal, since: now, agree: 1 };
    }

    const held = now - this.candidate.since;
    if (this.candidate.agree >= this.cfg.framesForConfirm && held >= this.cfg.holdDurationMs) {
      const value = kind === 'count' ? signal : undefined;
      this.lastConfirmed = { signal, at: now };
      this.cooldownUntil = now + this.cfg.cooldownMs;
      this.setState('confirmed');
      this.finish({
        outcome: 'confirmed',
        value,
        confidence: obs.presence,
      });
    }
  }

  /** Map a raw finger count to the signal we're trying to confirm for `kind`. */
  private signalFor(kind: AttemptKind, count: number): number | null {
    if (kind === 'start') return count >= this.cfg.openPalmMinFingers ? 1 : null;
    if (kind === 'stop') return count === 0 ? 1 : null;
    // 'count': subject select / self-rating, 1..5 only
    return count >= 1 && count <= 5 ? count : null;
  }

  private isThrottling(s: SystemSignal): boolean {
    return (
      s.lowPower ||
      s.thermal === 'serious' ||
      s.thermal === 'critical' ||
      s.deliveredFps < this.cfg.minAcceptableFps
    );
  }

  private finish(result: AttemptResult): void {
    if (!this.active) return;
    this.active = false;
    for (const c of this.cleanups.splice(0)) {
      try {
        c();
      } catch {
        /* ignore */
      }
    }
    try {
      this.deps.camera.stop();
    } catch {
      /* ignore */
    }
    this.candidate = null;

    const unavailableReasons: FallbackReason[] = [
      'degraded',
      'permission',
      'no-camera',
      'timeout', // camera didn't deliver — most likely OS/thermal throttling
      'error',
    ];
    if (result.outcome === 'confirmed') {
      this.setState('cooldown');
    } else if (result.fallbackReason && unavailableReasons.includes(result.fallbackReason)) {
      this.setState('unavailable');
    } else {
      this.setState('idle'); // 'no-gesture' | 'cooldown' — normal, just use buttons
    }

    const resolve = this.resolveAttempt;
    this.resolveAttempt = null;
    resolve?.(result);
  }

  private setState(s: GestureState): void {
    if (this.state === s) return;
    this.state = s;
    this.deps.onStateChange?.(s);
  }
}

function classifyStartError(err: unknown): FallbackReason {
  const msg = (err instanceof Error ? `${err.name} ${err.message}` : String(err)).toLowerCase();
  if (msg.includes('permission') || msg.includes('denied') || msg.includes('notallowed')) {
    return 'permission';
  }
  if (msg.includes('no camera') || msg.includes('notfound') || msg.includes('overconstrained')) {
    return 'no-camera';
  }
  return 'error';
}
