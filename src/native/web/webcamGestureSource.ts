import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { CameraSource, SystemSignal } from '../../features/gesture/GestureController';
import type { HandObservation, Landmark } from '../../features/gesture/fingerCounting';

/**
 * Real on-device (in-browser) gesture camera for the web demo:
 *   getUserMedia  ->  <video>  ->  MediaPipe Hand Landmarker (WASM)  ->  HandObservation
 *
 * Plugs into the SAME `GestureController` the native build uses. Every failure
 * mode resolves cleanly so the controller falls back to buttons:
 *   - camera permission denied      -> start() rejects (NotAllowedError)
 *   - no camera present             -> start() rejects (NotFoundError)
 *   - model / wasm fails to load    -> start() rejects (Error) -> 'error' fallback
 *   - frames stop arriving          -> controller arming-timeout / FPS watchdog
 *
 * Frames are only pulled while an attempt is active (start()..stop()); the
 * camera track is fully stopped on stop() — no idle streaming.
 */

export interface WebcamGestureOptions {
  /** MediaPipe vision WASM bundle. Defaults to the jsDelivr copy of the installed version. */
  wasmBase?: string;
  /** hand_landmarker.task model. Defaults to Google's hosted model. */
  modelUrl?: string;
  width?: number;
  height?: number;
  /** optional: mount the live <video> here so the UI can show a preview. */
  previewContainer?: HTMLElement | null;
}

const DEFAULT_WASM =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const DEFAULT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export function webcamGestureSource(opts: WebcamGestureOptions = {}): CameraSource {
  const width = opts.width ?? 480;
  const height = opts.height ?? 360;

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let landmarker: HandLandmarker | null = null;
  let raf = 0;
  let running = false;
  let lastVideoTime = -1;
  const frameCbs = new Set<(o: HandObservation | null) => void>();
  const signalCbs = new Set<(s: SystemSignal) => void>();

  // FPS estimate pushed to the controller as a courtesy signal.
  let frameStamps: number[] = [];

  async function start(): Promise<void> {
    if (running) return;
    running = true;
    lastVideoTime = -1;
    frameStamps = [];

    // 1) camera — may reject with NotAllowedError / NotFoundError
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: width }, height: { ideal: height } },
      audio: false,
    });

    video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.width = width;
    video.height = height;
    video.srcObject = stream;
    if (opts.previewContainer) {
      video.style.width = '100%';
      video.style.borderRadius = '12px';
      video.style.transform = 'scaleX(-1)'; // mirror for a natural selfie view
      opts.previewContainer.appendChild(video);
    }
    await video.play();
    await new Promise<void>((res) => {
      if (video && video.readyState >= 2) res();
      else video?.addEventListener('loadeddata', () => res(), { once: true });
    });

    // 2) model — may reject if wasm/model can't be fetched
    try {
      const fileset = await FilesetResolver.forVisionTasks(opts.wasmBase ?? DEFAULT_WASM);
      landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: opts.modelUrl ?? DEFAULT_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    } catch (err) {
      // surface as a plain error -> GestureController maps to 'error' fallback
      teardown();
      throw new Error(`hand-landmarker load failed: ${(err as Error).message}`);
    }

    loop();
  }

  function loop(): void {
    if (!running || !video || !landmarker) return;
    const nowMs = performance.now();
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      let obs: HandObservation | null = null;
      try {
        const res = landmarker.detectForVideo(video, nowMs);
        obs = toObservation(res);
      } catch {
        obs = null;
      }
      for (const cb of [...frameCbs]) cb(obs);

      frameStamps.push(nowMs);
      if (frameStamps.length > 12) frameStamps.shift();
      if (frameStamps.length >= 6) {
        const span = nowMs - frameStamps[0]!;
        const fps = span > 0 ? ((frameStamps.length - 1) * 1000) / span : 60;
        for (const cb of [...signalCbs]) {
          cb({ lowPower: false, thermal: 'nominal', deliveredFps: fps });
        }
      }
    }
    raf = requestAnimationFrame(loop);
  }

  function teardown(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    try {
      landmarker?.close();
    } catch {
      /* ignore */
    }
    landmarker = null;
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
      stream = null;
    }
    if (video) {
      video.srcObject = null;
      video.remove();
      video = null;
    }
  }

  return {
    start,
    stop: teardown,
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    onSystemSignal(cb) {
      signalCbs.add(cb);
      return () => signalCbs.delete(cb);
    },
  };
}

interface MpLandmark {
  x: number;
  y: number;
  z: number;
}
interface MpResult {
  landmarks: MpLandmark[][];
  handedness: Array<Array<{ categoryName: string; score: number }>>;
}

function toObservation(res: MpResult): HandObservation | null {
  const hand = res.landmarks?.[0];
  if (!hand || hand.length !== 21) return null;
  const landmarks: Landmark[] = hand.map((p) => ({ x: p.x, y: p.y, z: p.z }));
  const cat = res.handedness?.[0]?.[0];
  // MediaPipe reports handedness for the MIRRORED selfie image; flip it so
  // "Right" means the user's right hand, matching fingerCounting's thumb logic.
  const raw = cat?.categoryName === 'Left' ? 'Right' : 'Left';
  return {
    landmarks,
    handedness: raw,
    presence: cat?.score ?? 0.9,
  };
}
