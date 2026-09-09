import {
  addSample,
  classifyHand,
  emptyTemplateSet,
  isCalibrated,
  normalizeHand,
  sampleCount,
  type TemplateSet,
} from '@app/features/gesture/handTemplate';
import {
  trainHandMlp,
  predictHandMlp,
  serializeHandMlp,
  deserializeHandMlp,
  type HandMlp,
} from '@app/features/gesture/handModel';
import type { HandObservation } from '@app/features/gesture/fingerCounting';
import { webKeyValueStore } from '@app/native/web/webKeyValueStore';

/**
 * Per-user hand-shape learning.
 *
 *   MediaPipe 21 landmarks  ->  normalizeHand (42-dim, pos/scale/handedness free)
 *     +--> k-NN over your samples          (OOD gate: nothing like what you taught -> ignore)
 *     +--> tiny MLP trained in the browser (the decision among the taught poses)
 *
 * Labels the MLP learns:
 *   '0'..'5'   — the six built-in poses (fist / 1..5 fingers)
 *   'c:<id>'   — user-defined custom poses, each bound to one of 0..5 via `emits`
 *               (start = emits 5, stop = emits 0, subject slot N = emits N)
 *
 * Everything downstream still speaks the 0..5 count space, so custom poses need
 * no pipeline changes — a peace sign bound to `emits: 3` simply classifies as 3.
 */

const kv = webKeyValueStore('calib');
const SAMPLES_KEY = 'templates.v2';
const MLP_KEY = 'mlp.v2';
const CUSTOM_KEY = 'customs.v1';
export const CALIB_LABELS = ['0', '1', '2', '3', '4', '5'] as const;
export const SAMPLES_PER_LABEL = 12;

export interface CustomPose {
  id: string;
  name: string;
  /** what 0..5 count this pose produces (5 ~ start, 0 ~ stop, N ~ subject slot N). */
  emits: 0 | 1 | 2 | 3 | 4 | 5;
}
const customLabel = (id: string) => `c:${id}`;

let set: TemplateSet = loadSamples();
let mlp: HandMlp | null = loadMlp();
let customs: CustomPose[] = loadCustoms();
const listeners = new Set<() => void>();

function loadSamples(): TemplateSet {
  try {
    const raw = kv.getString(SAMPLES_KEY);
    if (raw) {
      const p = JSON.parse(raw) as TemplateSet;
      if (p && p.labels) return p;
    }
  } catch {
    /* ignore */
  }
  return emptyTemplateSet();
}
function loadMlp(): HandMlp | null {
  const raw = kv.getString(MLP_KEY);
  return raw ? deserializeHandMlp(raw) : null;
}
function loadCustoms(): CustomPose[] {
  try {
    const raw = kv.getString(CUSTOM_KEY);
    if (raw) return (JSON.parse(raw) as CustomPose[]).filter((c) => c && c.id);
  } catch {
    /* ignore */
  }
  return [];
}
function persist(): void {
  try {
    kv.set(SAMPLES_KEY, JSON.stringify(set));
    kv.set(CUSTOM_KEY, JSON.stringify(customs));
  } catch {
    /* ignore */
  }
  notify();
}
function notify(): void {
  for (const l of [...listeners]) l();
}

export function subscribeCalibration(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getTemplates(): TemplateSet {
  return set;
}
export function labelSampleCount(label: string): number {
  return sampleCount(set, label);
}
/** every built-in pose has enough samples to train / do k-NN. */
export function calibrationReady(): boolean {
  return isCalibrated(set, [...CALIB_LABELS], 3);
}
/** the MLP has been trained and is in use. */
export function calibrationTrained(): boolean {
  return mlp != null;
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
  mlp = null;
  customs = [];
  try {
    kv.delete(MLP_KEY);
  } catch {
    /* ignore */
  }
  persist();
}

// ── custom poses ───────────────────────────────────────────────────────────
export function listCustomPoses(): CustomPose[] {
  return customs;
}
export function addCustomPose(name: string, emits: CustomPose['emits']): string {
  const id = `p${Math.random().toString(36).slice(2, 8)}`;
  customs = [...customs, { id, name: name.trim() || '커스텀', emits }];
  persist();
  return id;
}
export function updateCustomPose(id: string, patch: Partial<Omit<CustomPose, 'id'>>): void {
  customs = customs.map((c) => (c.id === id ? { ...c, ...patch } : c));
  persist();
}
export function removeCustomPose(id: string): void {
  customs = customs.filter((c) => c.id !== id);
  delete set.labels[customLabel(id)];
  persist();
}
export function recordCustomSample(id: string, obs: HandObservation): boolean {
  return recordSample(customLabel(id), obs);
}
export function customSampleCount(id: string): number {
  return sampleCount(set, customLabel(id));
}

// ── training ───────────────────────────────────────────────────────────────
export interface TrainSummary {
  ok: boolean;
  accuracy: number;
  reason?: string;
}

export async function trainCalibration(onProgress?: (fraction: number) => void): Promise<TrainSummary> {
  if (!calibrationReady()) return { ok: false, accuracy: 0, reason: '기본 6포즈 샘플이 부족합니다 (각 3장 이상).' };

  const rows: { label: string; vec: number[] }[] = [];
  // built-ins
  for (const l of CALIB_LABELS) for (const vec of set.labels[l] ?? []) rows.push({ label: l, vec });
  // customs with enough samples
  for (const c of customs) {
    const vecs = set.labels[customLabel(c.id)] ?? [];
    if (vecs.length >= 3) for (const vec of vecs) rows.push({ label: customLabel(c.id), vec });
  }

  try {
    const epochs = 180;
    const { model, trainAccuracy } = await trainHandMlp(rows, {
      epochs,
      hidden: 24,
      augPerSample: 8,
      seed: 1,
      onProgress: async (e) => {
        onProgress?.(Math.min(1, e / epochs));
        await new Promise((r) => setTimeout(r, 0));
      },
    });
    mlp = model;
    kv.set(MLP_KEY, serializeHandMlp(model));
    onProgress?.(1);
    notify();
    return { ok: true, accuracy: trainAccuracy };
  } catch (err) {
    return { ok: false, accuracy: 0, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ── classification ─────────────────────────────────────────────────────────
const KNN_MAX_DISTANCE = 0.8;
const MLP_MIN_CONFIDENCE = 0.6;
const KNN_MIN_FALLBACK = 0.72;

/** map any label ('0'..'5' or 'c:<id>') to the 0..5 count it should emit. */
function labelToCount(label: string): number | null {
  if (label.startsWith('c:')) {
    const c = customs.find((x) => customLabel(x.id) === label);
    return c ? c.emits : null;
  }
  const n = Number(label);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
}

/** normalized hand -> 0..5, or null when it doesn't confidently match a taught pose. */
export function templateClassifyCount(obs: HandObservation): number | null {
  const v = normalizeHand(obs);
  if (!v) return null;
  if (!calibrationReady()) return null;

  const near = classifyHand(set, obs, KNN_MAX_DISTANCE); // OOD gate
  if (!near) return null;

  if (mlp) {
    const p = predictHandMlp(mlp, v);
    if (!p || p.confidence < MLP_MIN_CONFIDENCE) return null;
    return labelToCount(p.label);
  }
  const knn = classifyHand(set, obs, KNN_MIN_FALLBACK);
  if (!knn || knn.confidence < 0.35) return null;
  return labelToCount(knn.label);
}
