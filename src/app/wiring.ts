/**
 * Composition root — pure TypeScript, no react-native imports, so it typechecks
 * and tests on CI. The Expo entry (`App.tsx`) builds the real adapters
 * (VisionCamera, notifee, MMKV, op-sqlite, expo-haptics) and passes them here.
 * In dev/web/tests you pass the stubs from `src/native/stubs.ts`.
 */
import { SystemClock, type Clock } from '../core/time/clock';
import { SessionStore, type Persistence, type StoreConfig } from '../core/store';
import { InputBus, intentToCommand, type InputIntent } from '../input/intent';
import { GestureController, type CameraSource } from '../features/gesture/GestureController';
import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from '../features/gesture/gestureConfig';
import { isPaused } from '../core/session/elapsed';
import type { NativeClockBridge, ForegroundTimer, Haptics } from '../native/ports';

export interface Adapters {
  clockBridge?: Partial<NativeClockBridge>;
  persistence: Persistence;
  camera: CameraSource;
  foregroundTimer: ForegroundTimer;
  haptics: Haptics;
  now?: () => number;
  schedule?: (ms: number, fn: () => void) => () => void;
}

export interface AppConfig extends StoreConfig {
  gesture?: GestureConfig;
}

export interface App {
  store: SessionStore;
  bus: InputBus;
  gesture: GestureController;
  clock: Clock;
  /** honest disclosure of what the OS timer surface can actually do. */
  foregroundTimerCapabilities(): { liveTick: boolean; exactBackground: boolean; note: string };
  /** call on app foreground / resume. */
  syncOnForeground(): void;
  dispose(): void;
}

export function createApp(adapters: Adapters, config: AppConfig): App {
  const clock = new SystemClock(adapters.clockBridge);
  const store = new SessionStore(clock, adapters.persistence, config);

  const bus = new InputBus();
  const gesture = new GestureController({
    camera: adapters.camera,
    now: adapters.now ?? (() => clock.now().wall),
    schedule:
      adapters.schedule ??
      ((ms, fn) => {
        const h = setTimeout(fn, ms);
        return () => clearTimeout(h);
      }),
    config: config.gesture ?? DEFAULT_GESTURE_CONFIG,
  });

  // the ONE subscriber that turns every input (button/gesture/voice) into a command
  const unsub = bus.subscribe((intent: InputIntent) => {
    const active = store.getActive();
    const command = intentToCommand(intent, {
      hasActiveSession: active != null,
      isPaused: active ? isPaused(active) : false,
      newSessionId: () => `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    });
    if (!command) return;

    const result = store.dispatch(command);
    if (!result.ok) return;

    if (intent.source === 'gesture') adapters.haptics.success();

    if (command.type === 'START' && result.active) {
      void adapters.foregroundTimer.begin({
        startWall: result.active.start.wall,
        plannedMs: result.active.plannedMs,
        subjectLabel: null,
      });
    } else if (command.type === 'STOP') {
      void adapters.foregroundTimer.end();
    } else if (command.type === 'PAUSE' || command.type === 'RESUME') {
      const a = store.getActive();
      if (a) {
        void adapters.foregroundTimer.update({
          startWall: a.start.wall,
          plannedMs: a.plannedMs,
          paused: command.type === 'PAUSE',
        });
      }
    }
  });

  // cold-start crash recovery
  const outcome = store.inspectRecovery();
  if (outcome.kind === 'resumed' || outcome.kind === 'auto-finalized') {
    store.applyRecovery(outcome);
  }
  // 'needs-confirmation' is surfaced to the UI which calls store.applyRecovery(outcome, decision)

  const heartbeat = setInterval(() => store.heartbeat(), config.heartbeatMs ?? 15_000);

  return {
    store,
    bus,
    gesture,
    clock,
    foregroundTimerCapabilities: () => adapters.foregroundTimer.capabilities(),
    syncOnForeground() {
      // recompute from timestamps; the store's derivations are already pull-based,
      // so this just nudges subscribers and reconciles the foreground surface.
      const a = store.getActive();
      if (a) {
        void adapters.foregroundTimer.update({
          startWall: a.start.wall,
          plannedMs: a.plannedMs,
          paused: isPaused(a),
        });
      }
      store.heartbeat();
    },
    dispose() {
      unsub();
      clearInterval(heartbeat);
    },
  };
}
