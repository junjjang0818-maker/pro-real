import type { Subject } from '@app/core/subjects';
import type { KeyValueStore } from '@app/native/ports';

/**
 * Subjects have no home in the core `Persistence` yet (they are passed into the
 * derivations as a param), so the web demo owns them here — same shape a real
 * subjects repository would take. Backed by the same KV as the session store.
 */
const KEY = 'subjects.v2';

// 손가락 슬롯은 1~5. 한국사는 손가락 슬롯이 없어 버튼(또는 손 모양 학습) 전용.
const SEED: Subject[] = [
  { id: 'kor', label: '국어', colorToken: '#e0a54a', gestureFingerCount: 1, weeklyTargetMs: 5 * 3600_000, archivedAt: null, createdAt: Date.now() },
  { id: 'math', label: '수학', colorToken: '#e0685f', gestureFingerCount: 2, weeklyTargetMs: 8 * 3600_000, archivedAt: null, createdAt: Date.now() },
  { id: 'eng', label: '영어', colorToken: '#6ea8fe', gestureFingerCount: 3, weeklyTargetMs: 6 * 3600_000, archivedAt: null, createdAt: Date.now() },
  { id: 'soc', label: '사회', colorToken: '#4ec9a5', gestureFingerCount: 4, weeklyTargetMs: 4 * 3600_000, archivedAt: null, createdAt: Date.now() },
  { id: 'sci', label: '과학', colorToken: '#b98cff', gestureFingerCount: 5, weeklyTargetMs: 4 * 3600_000, archivedAt: null, createdAt: Date.now() },
  { id: 'hist', label: '한국사', colorToken: '#e88fb1', gestureFingerCount: null, weeklyTargetMs: 3 * 3600_000, archivedAt: null, createdAt: Date.now() },
];

export interface SubjectsStore {
  all(): Subject[];
  active(): Subject[];
  add(input: Pick<Subject, 'label' | 'colorToken' | 'weeklyTargetMs' | 'gestureFingerCount'>): void;
  update(id: string, patch: Partial<Subject>): void;
  archive(id: string): void;
  subscribe(fn: () => void): () => void;
}

export function createSubjectsStore(kv: KeyValueStore): SubjectsStore {
  const listeners = new Set<() => void>();
  let cache: Subject[] = load();

  function load(): Subject[] {
    const raw = kv.getString(KEY);
    if (!raw) {
      kv.set(KEY, JSON.stringify(SEED));
      return [...SEED];
    }
    try {
      return JSON.parse(raw) as Subject[];
    } catch {
      return [...SEED];
    }
  }
  function commit(next: Subject[]): void {
    cache = next;
    kv.set(KEY, JSON.stringify(next));
    for (const l of [...listeners]) l();
  }

  return {
    all: () => cache,
    active: () => cache.filter((s) => s.archivedAt == null),
    add: (input) =>
      commit([
        ...cache,
        {
          id: `sub_${Math.random().toString(36).slice(2, 8)}`,
          label: input.label,
          colorToken: input.colorToken,
          weeklyTargetMs: input.weeklyTargetMs,
          gestureFingerCount: input.gestureFingerCount,
          archivedAt: null,
          createdAt: Date.now(),
        },
      ]),
    update: (id, patch) => commit(cache.map((s) => (s.id === id ? { ...s, ...patch } : s))),
    archive: (id) => commit(cache.map((s) => (s.id === id ? { ...s, archivedAt: Date.now() } : s))),
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
