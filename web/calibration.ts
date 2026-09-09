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
 *     |
 *     +--> k-NN over your samples          (OOD gate: "nothing like what you taught" -> ignore)
 *     +--> tiny MLP trained in the browser (the decision among the taught poses)
 *
 * Enrollment stores raw samples per label '0'..'5'. Pressing "학습" trains the
 * MLP on those samples (augmented) and persists it. `templateClassifyCount` then
 * uses: k-NN distance to reject non-poses, MLP for the label. If the MLP hasn't
 * been trained yet, it falls back to pure k-NN so calibration still helps.
 */

const kv = webKeyValueStore('calib');
const SAMPLES_KEY = 'templates.v1';
const MLP_KEY = 'mlp.v1';
export const CALIB_LABELS = ['0', '1', '2', '3', '4', '5'] as const;
export const SAMPLES_PER_LABEL = 12;

let set: TemplateSet = loadSamples();
let mlp: HandMlp | null = loadMlp();
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
function persistSamples(): void {
  try {
    kv.set(SAMPLES_KEY, JSON.stringify(set));
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
/** every pose has enough samples to train / do k-NN. */
export function calibrationReady(): boolean {
  return isCalibrated(set, [...CALIB_LABELS], 3);
}
/** the MLP has been trained and is in use. */
export function calibrationTrained(): boolean {
  return mlp != null;
}

export function recordSample(label: string, obs: HandObservation): boolean {
  const ok = addSample(set, label, obs);
  if (ok) persistSamples();
  return ok;
}
export function clearLabel(label: string): void {
  delete set.labels[label];
  persistSamples();
}
export function clearAllCalibration(): void {
  set = emptyTemplateSet();
  mlp = null;
  try {
    kv.delete(MLP_KEY);
  } catch {
    /* ignore */
  }
  persistSamples();
}

export interface TrainSummary {
  ok: boolean;
  accuracy: number;
  reason?: string;
}

/** Train the MLP on the enrolled samples and persist it. */
export async function trainCalibration(
  onProgress?: (fraction: number) => void,
): Promise<TrainSummary> {
  if (!calibrationReady()) return { ok: false, accuracy: 0, reason: '샘플이 부족합니다 (포즈별 3개 이상 필요).' };
  const rows: { label: string; vec: number[] }[] = [];
  for (const [label, vecs] of Object.entries(set.labels)) {
    for (const vec of vecs) rows.push({ label, vec });
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
        await new Promise((r) => setTimeout(r, 0)); // let the UI paint
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

const KNN_MAX_DISTANCE = 0.8; // OOD gate: beyond this, the hand isn't any taught pose
const MLP_MIN_CONFIDENCE = 0.6;
const KNN_MIN_FALLBACK = 0.72;

/** normalized hand -> 0..5, or null when it doesn't confidently match a taught pose. */
export function templateClassifyCount(obs: HandObservation): number | null {
  const v = normalizeHand(obs);
  if (!v) return null;

  // OOD gate first (only if we have samples to compare against)
  if (calibrationReady()) {
    const near = classifyHand(set, obs, KNN_MAX_DISTANCE);
    if (!near) return null; // not close to anything the user taught
    if (mlp) {
      const p = predictHandMlp(mlp, v);
      if (!p || p.confidence < MLP_MIN_CONFIDENCE) return null;
      const n = Number(p.label);
      return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
    }
    // no MLP yet -> pure k-NN
    const knn = classifyHand(set, obs, KNN_MIN_FALLBACK);
    if (!knn || knn.confidence < 0.35) return null;
    const n = Number(knn.label);
    return Number.isInteger(n) && n >= 0 && n <= 5 ? n : null;
  }
  return null;
}
