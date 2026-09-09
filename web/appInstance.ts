import { createApp } from '@app/app/wiring';
import { kvPersistence } from '@app/native/kvPersistence';
import { webKeyValueStore } from '@app/native/web/webKeyValueStore';
import { webClockBridge } from '@app/native/web/webClock';
import { webHaptics } from '@app/native/web/webHaptics';
import { webForegroundTimer } from '@app/native/web/webForegroundTimer';
import { DEFAULT_GESTURE_CONFIG, type GestureConfig } from '@app/features/gesture/gestureConfig';
import { DEFAULT_FREEZE_CONFIG, type FreezeConfig } from '@app/core/derivations/streak';
import { DEFAULT_THROTTLER_CONFIG, type ThrottlerConfig } from '@app/features/gamification/notificationThrottler';
import { DEFAULT_QUOTE_SOURCES, type QuoteSourceConfig } from '@app/features/motivation/quotes';
import { prewarmGestureModel } from '@app/native/web/webcamGestureSource';
import { isPaused } from '@app/core/session/elapsed';
import { webCameraProxy } from './webCameraProxy';
import { createSubjectsStore } from './subjectsStore';
import { createGestureWatch } from './gestureWatch';

const kv = webKeyValueStore();

export const cameraProxy = webCameraProxy();
export const subjects = createSubjectsStore(kv);

// ── web-managed settings (things the core takes as call-time params) ─────────
export interface WebSettings {
  dailyGoalMin: number;
  freeze: FreezeConfig;
  throttler: ThrottlerConfig;
  quoteSources: QuoteSourceConfig;
  userGoals: string[];
  gestureOverrides: Partial<GestureConfig>;
  /** demo a full gesture flow with synthetic frames when there is no webcam. */
  gestureSim: boolean;
  /** keep the camera on and auto-detect start (open palm) / stop (fist) — no button. */
  gestureAuto: boolean;
}

const SETTINGS_KEY = 'web-settings.v3';
const DEFAULT_SETTINGS: WebSettings = {
  dailyGoalMin: 60,
  freeze: { ...DEFAULT_FREEZE_CONFIG },
  throttler: { ...DEFAULT_THROTTLER_CONFIG },
  quoteSources: { ...DEFAULT_QUOTE_SOURCES },
  userGoals: ['올해 목표: 매일 3시간'],
  // web needs a generous arming window (first attempt downloads the WASM + model)
  // and a slightly lower FPS floor (in-browser MediaPipe often runs ~10-15fps).
  gestureOverrides: {
    armingTimeoutMs: 15_000,
    maxBurstMs: 18_000,
    holdDurationMs: 500,
    framesForConfirm: 5,
    minHandSpan: 0.08,
    minAcceptableFps: 6,
  },
  gestureSim: false,
  gestureAuto: false,
};

function loadSettings(): WebSettings {
  const raw = kv.getString(SETTINGS_KEY);
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  try {
    const saved = JSON.parse(raw) as Partial<WebSettings>;
    const base = structuredClone(DEFAULT_SETTINGS);
    // shallow-merge top level, but deep-merge the nested config objects so new
    // default keys (e.g. a newly added gesture param) are not masked by a stale
    // saved object.
    return {
      ...base,
      ...saved,
      freeze: { ...base.freeze, ...saved.freeze },
      throttler: { ...base.throttler, ...saved.throttler },
      quoteSources: { ...base.quoteSources, ...saved.quoteSources },
      gestureOverrides: { ...base.gestureOverrides, ...saved.gestureOverrides },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

let settings = loadSettings();
const settingsListeners = new Set<() => void>();

export function getSettings(): WebSettings {
  return settings;
}
export function subscribeSettings(fn: () => void): () => void {
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}
export function updateSettings(patch: Partial<WebSettings>): void {
  settings = { ...settings, ...patch };
  // persist only gesture overrides the user actually changed, so future default
  // changes still reach sliders they never touched.
  const gOverrides: Partial<GestureConfig> = {};
  const base = { ...DEFAULT_GESTURE_CONFIG, ...DEFAULT_SETTINGS.gestureOverrides } as Record<string, number>;
  for (const [k, v] of Object.entries(settings.gestureOverrides)) {
    if (v !== base[k]) (gOverrides as Record<string, number>)[k] = v as number;
  }
  kv.set(SETTINGS_KEY, JSON.stringify({ ...settings, gestureOverrides: gOverrides }));
  app.store.updateConfig({ dailyGoalMs: settings.dailyGoalMin * 60_000, freezeConfig: settings.freeze });
  app.gesture.updateConfig({ ...DEFAULT_GESTURE_CONFIG, ...settings.gestureOverrides });
  cameraProxy.setSimulating(settings.gestureSim);
  syncGestureWatch();
  for (const l of [...settingsListeners]) l();
}

let watchStarting = false;
function syncGestureWatch(): void {
  if (typeof window === 'undefined') return;
  const want = settings.gestureAuto && !settings.gestureSim;
  const st = gestureWatch.getState().status;
  if (want && st === 'off' && !watchStarting) {
    watchStarting = true;
    void gestureWatch.start().finally(() => {
      watchStarting = false;
    });
  } else if (!want && st !== 'off') {
    gestureWatch.stop();
  }
}

// ── the app ────────────────────────────────────────────────────────────────
export const app = createApp(
  {
    clockBridge: webClockBridge(),
    persistence: kvPersistence(kv),
    camera: cameraProxy.source,
    foregroundTimer: webForegroundTimer(),
    haptics: webHaptics(),
  },
  {
    dailyGoalMs: settings.dailyGoalMin * 60_000,
    freezeConfig: settings.freeze,
    gesture: { ...DEFAULT_GESTURE_CONFIG, ...settings.gestureOverrides },
  },
);

// ── always-on gesture watcher (opt-in) ─────────────────────────────────────
let autoPreviewEl: HTMLElement | null = null;
export function setAutoGesturePreview(el: HTMLElement | null): void {
  autoPreviewEl = el;
}
let autoStartSubjectId: string | null = null;
let autoStartPlannedMs: number | null = null;
export function setAutoStartParams(subjectId: string | null, plannedMs: number | null): void {
  autoStartSubjectId = subjectId;
  autoStartPlannedMs = plannedMs;
}
export const gestureWatch = createGestureWatch({
  isSessionActive: () => app.store.getActive() != null,
  onStart: () =>
    app.bus.emit({ purpose: 'start', source: 'gesture', subjectId: autoStartSubjectId, plannedMs: autoStartPlannedMs }),
  onStop: () => {
    const a = app.store.getActive();
    if (a && isPaused(a)) app.bus.emit({ purpose: 'toggle-pause', source: 'gesture' });
    app.bus.emit({ purpose: 'stop', source: 'gesture' });
  },
  getConfig: () => ({ ...DEFAULT_GESTURE_CONFIG, ...settings.gestureOverrides }),
  previewContainer: () => autoPreviewEl,
});

// surface a needs-confirmation recovery to the UI
export const pendingRecovery = app.store.inspectRecovery();

export const installDate = (() => {
  const k = 'install-date.v1';
  const existing = kv.getString(k);
  if (existing) return existing;
  const d = new Date();
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  kv.set(k, iso);
  return iso;
})();

cameraProxy.setSimulating(settings.gestureSim);

// warm the MediaPipe model in the background so the first gesture attempt is
// snappy (skipped in simulation mode — no model needed there).
if (typeof window !== 'undefined' && !settings.gestureSim) {
  setTimeout(() => void prewarmGestureModel(), 1500);
}
// start the always-on watcher if it was left enabled
if (typeof window !== 'undefined') setTimeout(syncGestureWatch, 1800);

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => app.syncOnForeground());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) app.syncOnForeground();
  });
  // dev-only handle for manual poking from the console / automated checks
  if (import.meta.env?.DEV) {
    (window as unknown as { __gst: unknown }).__gst = {
      app,
      cameraProxy,
      gestureWatch,
      subjects,
      getSettings,
      updateSettings,
    };
  }
}
