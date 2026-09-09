import {
  addSample,
  classifyHand,
  emptyTemplateSet,
  isCalibrated,
  sampleCount,
  type TemplateSet,
} from '@app/features/gesture/handTemplate';
import type { HandObservation } from '@app/features/gesture/fingerCounting';
import { webKeyValueStore } from '@app/native/web/webKeyValueStore';

/**
 * Stores the user's learned hand shapes and exposes a classifier the gesture
 * pipeline uses in place of the finger-angle heuristic once calibration is done.
 * Labels are '0'..'5' (fist / 1..5 fingers) — the same 0..5 space the rest of
 * the app already speaks, so nothing downstream changes.
 */

const kv = webKeyValueStore('calib');
const KEY = 'templates.v1';
export const CALIB_LABELS = ['0', '1', '2', '3', '4', '5'] as const;
export const SAMPLES_PER_LABEL = 12;

let set: TemplateSet = load();
const listeners = new Set<() => void>();

function load(): TemplateSet {
  try {
    const raw = kv.getString(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TemplateSet;
      if (parsed && parsed.labels) return parsed;
    }
  } catch {
    /* ignore */
  }
  return emptyTemplateSet();
}
function persist(): void {
  try {
    kv.set(KEY, JSON.stringify(set));
  } catch {
    /* ignore */
  }
  for (const l of [...listeners]) l();
}

export function subscribeCalibration(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getTemplates(): TemplateSet {
  return set;
}
export function calibrationReady(): boolean {
  return isCalibrated(set, [...CALIB_LABELS], 3);
}
export function labelSampleCount(label: string): number {
  return sampleCount(set, label);
}
export function recordSample(label: string, obs: HandObservation): boolean {
  const ok = addSample(set, label, obs);
  if (ok) persist();
  return ok;
}
export function clearLabel(label: string): void {
  delete set.labels[label];
  persist();
}
export function clearAllCalibration(): void {
  set = emptyTemplateSet();
  persist();
}

/** RMS-distance ceiling for a match; a bit looser than the lib default because
 *  webcam noise > synthetic. Tunable later. */
const MAX_DISTANCE = 0.72;

/** Classifier for the gesture pipeline: normalized hand -> 0..5, or null when
 *  the pose doesn't confidently match anything the user taught. */
export function templateClassifyCount(obs: HandObservation): number | null {
  if (!calibrationReady()) return null;
  const r = classifyHand(set, obs, MAX_DISTANCE);
  if (!r || r.confidence < 0.35) return null;
  const n = Number(r.label);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
}
