import { useEffect, useState } from 'react';
import { app, subjects, getSettings, installDate } from './appInstance';
import { webKeyValueStore } from '@app/native/web/webKeyValueStore';
import { getAnalysis, type AnalysisCache, type AnalysisTransport, type AnalysisViewState, type CachedAnalysis } from '@app/core/analysis/client';
import { computeStreak } from '@app/core/derivations/streak';

const kv = webKeyValueStore('analysis');
const CACHE_KEY = 'last.v1';

/** localStorage-backed cache for the last successful analysis. */
const cache: AnalysisCache = {
  read: () => {
    const raw = kv.getString(CACHE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedAnalysis;
    } catch {
      return null;
    }
  },
  write: (v) => kv.set(CACHE_KEY, JSON.stringify(v)),
};

/**
 * Transport. If a backend URL is configured (localStorage `analysis:endpoint`)
 * it POSTs the facts there; otherwise it rejects so `getAnalysis` degrades to
 * the deterministic on-device template comment. This demonstrates the
 * offline / API-failure path without needing a server.
 */
const transport: AnalysisTransport = {
  async fetchComment(facts, signal) {
    const endpoint = kv.getString('endpoint');
    if (!endpoint) throw new Error('offline: no analysis endpoint configured (using on-device template)');
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(facts),
      signal,
    });
    if (!res.ok) throw new Error(`server ${res.status}`);
    const data = (await res.json()) as { comment?: string };
    if (!data.comment) throw new Error('server: empty comment');
    return data.comment;
  },
};

export function setAnalysisEndpoint(url: string | null): void {
  if (url) kv.set('endpoint', url);
  else kv.delete('endpoint');
}
export function getAnalysisEndpoint(): string | null {
  return kv.getString('endpoint');
}

export function useAnalysis(windowDays: 7 | 30, nonce: number): { loading: boolean; state: AnalysisViewState | null } {
  const [state, setState] = useState<AnalysisViewState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const today = app.store.today();
    const streak = computeStreak({ attendance: app.store.attendance(), today, freezeConfig: getSettings().freeze });
    void getAnalysis({
      sessions: [...app.store.getSessions()],
      subjects: subjects.active(),
      streak,
      installDate,
      today,
      windowDays,
      dailyGoalMs: app.store.getConfig().dailyGoalMs,
      locale: 'ko-KR',
      anonymousInstallId: anonId(),
      now: app.clock.now(),
      transport,
      cache,
      timeoutMs: 6000,
    }).then((s) => {
      if (alive) {
        setState(s);
        setLoading(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [windowDays, nonce]);

  return { loading, state };
}

function anonId(): string {
  const k = webKeyValueStore('analysis');
  let id = k.getString('anon');
  if (!id) {
    id = crypto.randomUUID?.() ?? `anon-${Math.random().toString(36).slice(2)}`;
    k.set('anon', id);
  }
  return id;
}
