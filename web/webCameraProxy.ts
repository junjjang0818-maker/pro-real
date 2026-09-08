import type { CameraSource, SystemSignal } from '@app/features/gesture/GestureController';
import type { HandObservation } from '@app/features/gesture/fingerCounting';
import { webcamGestureSource } from '@app/native/web/webcamGestureSource';

/**
 * A stable `CameraSource` handed to `createApp` once, that lazily builds a fresh
 * `webcamGestureSource` for each `attempt()` and can be pointed at a preview
 * container that only exists while the gesture overlay is mounted.
 */
export interface WebCameraProxy {
  source: CameraSource;
  setPreviewContainer(el: HTMLElement | null): void;
}

export function webCameraProxy(): WebCameraProxy {
  let previewEl: HTMLElement | null = null;
  let real: CameraSource | null = null;
  let realUnsub: Array<() => void> = [];
  const frameCbs = new Set<(o: HandObservation | null) => void>();
  const signalCbs = new Set<(s: SystemSignal) => void>();

  const source: CameraSource = {
    async start() {
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
  };
}
