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
import { webCameraProxy } from './webCameraProxy';
import { createSubjectsStore } from './subjectsStore';

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
}

const SETTINGS_KEY = 'web-settings.v1';
const DEFAULT_SETTINGS: WebSettings = {
  dailyGoalMin: 60,
  freeze: { ...DEFAULT_FREEZE_CONFIG },
  throttler: { ...DEFAULT_THROTTLER_CONFIG },
  quoteSources: { ...DEFAULT_QUOTE_SOURCES },
  userGoals: ['올해 목표: 매일 3시간'],
  // web needs a generous arming window: the first attempt downloads the WASM + model
  gestureOverrides: { armingTimeoutMs: 12_000, maxBurstMs: 15_000, holdDurationMs: 500, framesForConfirm: 5, minHandSpan: 0.08 },
};

function loadSettings(): WebSettings {
  const raw = kv.getString(SETTINGS_KEY);
  if (!raw) return structuredClone(DEFAULT_SETTINGS);
  try {
    return { ...structuredClone(DEFAULT_SETTINGS), ...(JSON.parse(raw) as Partial<WebSettings>) };
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
  kv.set(SETTINGS_KEY, JSON.stringify(settings));
  app.store.updateConfig({ dailyGoalMs: settings.dailyGoalMin * 60_000, freezeConfig: settings.freeze });
  app.gesture.updateConfig({ ...DEFAULT_GESTURE_CONFIG, ...settings.gestureOverrides });
  for (const l of [...settingsListeners]) l();
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

if (typeof window !== 'undefined') {
  window.addEventListener('focus', () => app.syncOnForeground());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) app.syncOnForeground();
  });
}
