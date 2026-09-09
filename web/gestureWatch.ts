import { countExtendedFingers, type HandObservation } from '@app/features/gesture/fingerCounting';
import { HoldGate } from '@app/features/gesture/holdGate';
import { webcamGestureSource, lastGestureLoadError } from '@app/native/web/webcamGestureSource';
import type { GestureConfig } from '@app/features/gesture/gestureConfig';

/**
 * Always-on gesture watcher for the web demo: the camera stays live and, with
 * no session, an open palm held for a moment starts one; while a session runs, a
 * held fist stops it — no button press. Uses the SAME misrecognition-prevention
 * rules as the one-shot flow (via HoldGate). Opt-in (Settings) because a
 * continuously-on camera costs battery — the native app's default is the brief's
 * burst-only model.
 */

export type WatchStatus = 'off' | 'loading' | 'watching' | 'error';
export type WatchTarget = 'start' | 'stop';

export interface WatchState {
  status: WatchStatus;
  target: WatchTarget;
  count: number | null;
  progress: number; // 0..1 toward a confirm for the current candidate
  cooldown: boolean;
  error?: string;
}

export interface GestureWatchDeps {
  isSessionActive: () => boolean;
  onStart: () => void;
  onStop: () => void;
  getConfig: () => GestureConfig;
  previewContainer: () => HTMLElement | null;
  /** learned-hand-shape classifier: obs -> 0..5, or null to fall back to heuristic. */
  classifyCount?: (obs: HandObservation) => number | null;
}

export function createGestureWatch(deps: GestureWatchDeps) {
  let source: ReturnType<typeof webcamGestureSource> | null = null;
  let offFrame: (() => void) | null = null;
  let gate: HoldGate | null = null;
  let curTarget: WatchTarget = 'start';
  const listeners = new Set<(s: WatchState) => void>();
  let state: WatchState = { status: 'off', target: 'start', count: null, progress: 0, cooldown: false };

  const emit = (patch: Partial<WatchState>) => {
    state = { ...state, ...patch };
    for (const l of [...listeners]) l(state);
  };

  const buildGate = () => {
    const c = deps.getConfig();
    gate = new HoldGate({
      framesForConfirm: c.framesForConfirm,
      holdDurationMs: c.holdDurationMs,
      cooldownMs: c.cooldownMs,
      distinctGestureDebounceMs: c.distinctGestureDebounceMs,
    });
  };

  const onFrame = (obs: HandObservation | null) => {
    if (!gate) return;
    const now = performance.now();
    const c = deps.getConfig();

    const target: WatchTarget = deps.isSessionActive() ? 'stop' : 'start';
    if (target !== curTarget) {
      curTarget = target;
      gate.hardReset();
      emit({ target });
    }

    let count: number | null = null;
    let signal: number | null = null;
    if (obs) {
      const learned = deps.classifyCount?.(obs);
      if (learned != null) {
        count = learned;
      } else {
        const fc = countExtendedFingers(obs, {
          minPresence: c.minConfidence,
          minHandSpan: c.minHandSpan,
          extendMargin: c.extendMargin,
        });
        if (fc.usable) count = fc.count;
      }
      if (count != null) {
        signal = target === 'start' ? (count >= c.openPalmMinFingers ? 1 : null) : count === 0 ? 1 : null;
      }
    }

    const r = gate.feed(signal, now);
    emit({
      count,
      progress: Math.min(1, r.progressFrames / Math.max(1, c.framesForConfirm)),
      cooldown: r.inCooldown,
    });

    if (r.confirmed) {
      if (target === 'start') deps.onStart();
      else deps.onStop();
    }
  };

  return {
    getState: () => state,
    subscribe(fn: (s: WatchState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    async start() {
      if (source) return;
      emit({ status: 'loading', error: undefined });
      buildGate();
      curTarget = deps.isSessionActive() ? 'stop' : 'start';
      source = webcamGestureSource({ previewContainer: deps.previewContainer() });
      try {
        offFrame = source.onFrame(onFrame);
        await source.start();
        emit({ status: 'watching', target: curTarget });
      } catch (err) {
        offFrame?.();
        offFrame = null;
        source?.stop();
        source = null;
        emit({
          status: 'error',
          error: (err instanceof Error ? err.message : String(err)) + (lastGestureLoadError() ? ` · ${lastGestureLoadError()}` : ''),
        });
      }
    },
    stop() {
      offFrame?.();
      offFrame = null;
      source?.stop();
      source = null;
      gate = null;
      emit({ status: 'off', count: null, progress: 0, cooldown: false });
    },
  };
}
