/**
 * Non-native stub adapters. They let the JS run in dev/web/node and make the
 * "needs a real device" seams obvious. Replace in `src/app/wiring.ts` with the
 * real react-native modules for a device build.
 */
import type { HandObservation } from '../features/gesture/fingerCounting';
import type { CameraSource, SystemSignal } from '../features/gesture/GestureController';
import type {
  ForegroundTimer,
  Haptics,
  KeyValueStore,
  NativeClockBridge,
} from './ports';

const NEEDS_NATIVE = (what: string) =>
  new Error(`[native-stub] ${what} requires a real device build (see src/native/README.md)`);

/** performance.now()-based monotonic; WRONG across an app relaunch — device bridge required for recovery. */
export const clockBridgeStub: Partial<NativeClockBridge> = {
  monotonicMs: () => Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now()),
  bootId: () => 'stub-boot',
};

/** A camera source that never produces frames — always routes the UI to buttons. */
export const noopCameraSource: CameraSource = {
  async start() {
    /* resolves, but delivers no frames -> GestureController arming timeout -> button fallback */
  },
  stop() {},
  onFrame(_cb: (o: HandObservation | null) => void) {
    return () => {};
  },
  onSystemSignal(_cb: (s: SystemSignal) => void) {
    return () => {};
  },
};

export const foregroundTimerStub: ForegroundTimer = {
  async begin() {},
  async update() {},
  async end() {},
  capabilities: () => ({
    liveTick: false,
    exactBackground: false,
    note: 'Stub: no OS-level timer surface. Device build uses Android FGS + iOS Live Activity.',
  }),
};

export const hapticsStub: Haptics = {
  success() {},
  warning() {},
  selection() {},
};

export function memoryKeyValueStore(): KeyValueStore {
  const m = new Map<string, string>();
  return {
    getString: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    delete: (k) => void m.delete(k),
  };
}

export { NEEDS_NATIVE };
