/**
 * A `Persistence` implementation backed by a synchronous key-value store
 * (`react-native-mmkv` in the app, in-memory in tests). Suitable for the MVP:
 * the whole session list is JSON in one key. Phase 3 swaps the session log for
 * SQLite (`op-sqlite`) behind the same `Persistence` interface while keeping the
 * crash-recovery snapshot in KV (it must be a synchronous write).
 */
import type { Persistence } from '../core/store';
import type { Session, SessionEvent, ActiveSessionSnapshot } from '../core/session/types';
import type { KeyValueStore } from './ports';

const K = {
  sessions: 'sessions.v1',
  events: 'events.v1',
  snapshot: 'active-snapshot.v1',
  badges: 'awarded-badges.v1',
} as const;

function readJson<T>(kv: KeyValueStore, key: string, fallback: T): T {
  const raw = kv.getString(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function kvPersistence(kv: KeyValueStore): Persistence {
  return {
    loadSessions: () => readJson<Session[]>(kv, K.sessions, []),
    appendSession: (s) => {
      const all = readJson<Session[]>(kv, K.sessions, []);
      kv.set(K.sessions, JSON.stringify([...all, s]));
    },
    updateSession: (s) => {
      const all = readJson<Session[]>(kv, K.sessions, []);
      kv.set(K.sessions, JSON.stringify(all.map((x) => (x.id === s.id ? s : x))));
    },
    appendEvents: (e) => {
      const all = readJson<SessionEvent[]>(kv, K.events, []);
      kv.set(K.events, JSON.stringify([...all, ...e]));
    },
    loadSnapshot: () => readJson<ActiveSessionSnapshot | null>(kv, K.snapshot, null),
    writeSnapshot: (s) => {
      if (s == null) kv.delete(K.snapshot);
      else kv.set(K.snapshot, JSON.stringify(s));
    },
    loadAwardedBadges: () => readJson<string[]>(kv, K.badges, []),
    writeAwardedBadges: (ids) => kv.set(K.badges, JSON.stringify(ids)),
  };
}
