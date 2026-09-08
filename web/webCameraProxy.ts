import type { CameraSource, SystemSignal } from '@app/features/gesture/GestureController';
import type { HandObservation } from '@app/features/gesture/fingerCounting';
import { webcamGestureSource } from '@app/native/web/webcamGestureSource';

/**
 * A stable `CameraSource` handed to `createApp` once, that lazily builds a fresh
 * `webcamGestureSource` for each `attempt()` and can be pointed at a preview
 * container that only exists while the gesture overlay is mounted.
 *
 * Simulation mode: when `setSimulating(true)`, `start()` does NOT open the
 * webcam — frames are pushed in by the caller via `emitSyntheticFrame()`. This
 * powers the demo's "제스처 시뮬레이션 (웹캠 없이)" toggle and lets the gesture
 * pipeline be exercised end-to-end on a machine with no camera.
 */
export interface WebCameraProxy {
  source: CameraSource;
  setPreviewContainer(el: HTMLElement | null): void;
  setSimulating(on: boolean): void;
  isSimulating(): boolean;
  emitSyntheticFrame(obs: HandObservation | null): void;
}

export function webCameraProxy(): WebCameraProxy {
  let previewEl: HTMLElement | null = null;
  let simulating = false;
  let real: CameraSource | null = null;
  let realUnsub: Array<() => void> = [];
  const frameCbs = new Set<(o: HandObservation | null) => void>();
  const signalCbs = new Set<(s: SystemSignal) => void>();

  const source: CameraSource = {
    async start() {
      if (simulating) return; // frames arrive via emitSyntheticFrame()
      real = webcamGestureSource({ previewContainer: previewEl });
      realUnsub = [
        real.onFrame((o) => {
          for (const cb of [...frameCbs]) cb(o);
        }),
        real.onSystemSignal((s) => {
          for (const cb of [...signalCbs]) cb(s);
        }),
      ];
      await real.start();
    },
    stop() {
      for (const u of realUnsub) u();
      realUnsub = [];
      real?.stop();
      real = null;
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onSystemSignal(cb) {
      signalCbs.add(cb);
      return () => signalCbs.delete(cb);
    },
  };

  return {
    source,
    setPreviewContainer(el) {
      previewEl = el;
    },
    setSimulating(on) {
      simulating = on;
    },
    isSimulating: () => simulating,
    emitSyntheticFrame(obs) {
      for (const cb of [...frameCbs]) cb(obs);
    },
  };
}
