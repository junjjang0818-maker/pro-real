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
 *   - model / wasm fails to load    -> start() rejects with a readable message
 *   - frames stop arriving          -> controller arming-timeout / FPS watchdog
 *
 * WASM loads from the LOCAL copy (`public/mediapipe/wasm`, copied out of
 * node_modules by scripts/prep-web.mjs) so the JS API and WASM glue are always
 * the same version. A version-matched jsDelivr URL is the fallback. The GPU
 * delegate is tried first, then CPU.
 */

export interface WebcamGestureOptions {
  wasmBase?: string;
  wasmCdn?: string;
  modelUrl?: string;
  width?: number;
  height?: number;
  previewContainer?: HTMLElement | null;
}

const MP_VERSION = typeof __MEDIAPIPE_VERSION__ !== 'undefined' ? __MEDIAPIPE_VERSION__ : '0.10.35';
const LOCAL_WASM = '/mediapipe/wasm';
const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const DEFAULT_MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

/** Last load error, surfaced to the UI so the user can tell what failed. */
let lastLoadError: string | null = null;
export function lastGestureLoadError(): string | null {
  return lastLoadError;
}

/**
 * The HandLandmarker (WASM + ~7.5MB model) is expensive to build the first time
 * (several seconds). Cache it for the session keyed by its config so only the
 * FIRST gesture attempt pays the cost; later attempts are ~instant.
 */
let cached: { key: string; lm: HandLandmarker } | null = null;
let prewarming: Promise<void> | null = null;

export function disposeGestureModel(): void {
  try {
    cached?.lm.close();
  } catch {
    /* ignore */
  }
  cached = null;
}

/**
 * Optionally load the model ahead of time (no camera) so the first gesture
 * attempt doesn't wait several seconds for the ~7.5MB download. Fire-and-forget;
 * failures are swallowed (the attempt will retry and surface the error then).
 */
export function prewarmGestureModel(opts: { wasmBase?: string; wasmCdn?: string; modelUrl?: string } = {}): Promise<void> {
  if (cached || prewarming) return prewarming ?? Promise.resolve();
  const modelUrl = opts.modelUrl ?? readOverride('gst:gesture-model') ?? DEFAULT_MODEL;
  const wasmBases = [opts.wasmBase ?? LOCAL_WASM, opts.wasmCdn ?? CDN_WASM];
  prewarming = loadLandmarker(wasmBases, modelUrl)
    .then((lm) => {
      cached = { key: `${wasmBases.join('|')}::${modelUrl}`, lm };
    })
    .catch((e) => {
      lastLoadError = describe(e);
    })
    .finally(() => {
      prewarming = null;
    });
  return prewarming;
}

export function webcamGestureSource(opts: WebcamGestureOptions = {}): CameraSource {
  const width = opts.width ?? 480;
  const height = opts.height ?? 360;
  const modelUrl = opts.modelUrl ?? readOverride('gst:gesture-model') ?? DEFAULT_MODEL;
  const wasmBases = [opts.wasmBase ?? LOCAL_WASM, opts.wasmCdn ?? CDN_WASM];

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  let landmarker: HandLandmarker | null = null;
  let raf = 0;
  let running = false;
  let lastVideoTime = -1;
  const frameCbs = new Set<(o: HandObservation | null) => void>();
  const signalCbs = new Set<(s: SystemSignal) => void>();
  let frameStamps: number[] = [];

  async function start(): Promise<void> {
    if (running) return;
    running = true;
    lastVideoTime = -1;
    frameStamps = [];
    lastLoadError = null;

    if (!navigator.mediaDevices?.getUserMedia) {
      teardown();
      throw new Error('이 브라우저는 카메라(getUserMedia)를 지원하지 않습니다. HTTPS 또는 localhost 인지 확인하세요.');
    }

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
      video.style.transform = 'scaleX(-1)';
      opts.previewContainer.appendChild(video);
    }
    await video.play();
    await new Promise<void>((res) => {
      if (video && video.readyState >= 2) res();
      else video?.addEventListener('loadeddata', () => res(), { once: true });
    });

    // 2) model — cached for the session; first build tries local wasm then CDN,
    //    GPU then CPU. Wait for an in-flight prewarm if there is one.
    const key = `${wasmBases.join('|')}::${modelUrl}`;
    if (prewarming) await prewarming.catch(() => {});
    if (cached?.key === key) {
      landmarker = cached.lm;
    } else {
      try {
        const lm = await loadLandmarker(wasmBases, modelUrl);
        disposeGestureModel();
        cached = { key, lm };
        landmarker = lm;
      } catch (err) {
        lastLoadError = describe(err);
        teardown();
        throw new Error(`hand-landmarker load failed: ${lastLoadError}`);
      }
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
        obs = toObservation(landmarker.detectForVideo(video, nowMs) as MpResult);
      } catch {
        obs = null;
      }
      for (const cb of [...frameCbs]) cb(obs);

      frameStamps.push(nowMs);
      if (frameStamps.length > 12) frameStamps.shift();
      if (frameStamps.length >= 6) {
        const span = nowMs - frameStamps[0]!;
        const fps = span > 0 ? ((frameStamps.length - 1) * 1000) / span : 60;
        for (const cb of [...signalCbs]) cb({ lowPower: false, thermal: 'nominal', deliveredFps: fps });
      }
    }
    raf = requestAnimationFrame(loop);
  }

  function teardown(): void {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    // keep the (cached) landmarker alive for the next attempt; just drop our ref
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

async function loadLandmarker(wasmBases: string[], modelUrl: string): Promise<HandLandmarker> {
  let lastErr: unknown;
  for (const base of wasmBases) {
    let fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;
    try {
      fileset = await FilesetResolver.forVisionTasks(base);
    } catch (e) {
      lastErr = e;
      continue; // try the next wasm source
    }
    for (const delegate of ['GPU', 'CPU'] as const) {
      try {
        return await HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: modelUrl, delegate },
          runningMode: 'VIDEO',
          numHands: 1,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr ?? new Error('unknown MediaPipe load failure');
}

function readOverride(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function describe(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
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
  return { landmarks, handedness: raw, presence: cat?.score ?? 0.9 };
}
