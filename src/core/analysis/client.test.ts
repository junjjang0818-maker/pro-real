import { describe, it, expect, beforeEach } from 'vitest';
import { getAnalysis, type AnalysisTransport, type AnalysisCache, type CachedAnalysis } from './client';
import type { AnalysisFacts } from './facts';
import { completedOn, resetIds, MIN, HOUR } from '../derivations/testFixtures';
import { computeStreak } from '../derivations/streak';
import { computeDailyAttendance } from '../derivations/attendance';
import type { Subject } from '../subjects';

beforeEach(resetIds);

const math: Subject = {
  id: 'math', label: '수학', colorToken: 'red', gestureFingerCount: 1,
  weeklyTargetMs: 7 * HOUR, archivedAt: null, createdAt: 0,
};

// enough data to pass the guard, with a real deficit for the template fallback
const sessions = [
  completedOn('2026-09-04', 20 * MIN, { subjectId: 'math' }),
  completedOn('2026-09-05', 20 * MIN, { subjectId: 'math' }),
  completedOn('2026-09-06', 20 * MIN, { subjectId: 'math' }),
  completedOn('2026-09-07', 20 * MIN, { subjectId: 'math' }),
  completedOn('2026-09-08', 20 * MIN, { subjectId: 'math' }),
];

function baseOpts() {
  return {
    sessions,
    subjects: [math],
    streak: computeStreak({
      attendance: computeDailyAttendance({ sessions, defaultGoalMs: 60 * MIN }),
      today: '2026-09-08',
    }),
    installDate: '2026-09-01',
    today: '2026-09-08',
    windowDays: 7 as const,
    dailyGoalMs: 60 * MIN,
    locale: 'ko-KR',
    anonymousInstallId: 'uuid-abc',
    now: { wall: 1_700_000_000_000, monotonic: 0, bootId: 'b', tzId: 'Asia/Seoul', tzOffsetMin: 540 },
  };
}

function memoryCache(seed?: CachedAnalysis): AnalysisCache {
  let store = seed ?? null;
  return { read: () => store, write: (v) => { store = v; } };
}

const okTransport = (comment: string): AnalysisTransport => ({
  fetchComment: async () => comment,
});

describe('getAnalysis — happy path', () => {
  it('calls the backend, returns fresh, and writes the cache', async () => {
    const cache = memoryCache();
    const state = await getAnalysis({
      ...baseOpts(),
      transport: okTransport('수학에 조금 더 시간을 써봐요.'),
      cache,
    });
    expect(state).toMatchObject({ kind: 'fresh', comment: '수학에 조금 더 시간을 써봐요.' });
    expect(cache.read()?.source).toBe('llm');
  });
});

describe('getAnalysis — 데이터 부족', () => {
  it('short-circuits to collecting without calling the backend', async () => {
    let called = false;
    const state = await getAnalysis({
      ...baseOpts(),
      sessions: [],
      installDate: '2026-09-08',
      transport: { fetchComment: async () => { called = true; return 'x'; } },
      cache: memoryCache(),
    });
    expect(state.kind).toBe('collecting');
    expect(called).toBe(false);
  });
});

describe('getAnalysis — API 실패 처리', () => {
  it('network error WITH a cached result => stale + offline + cached comment', async () => {
    const seed: CachedAnalysis = {
      facts: {} as AnalysisFacts,
      comment: '지난 분석: 영어를 더 해봐요.',
      generatedAtWall: 111,
      source: 'llm',
    };
    const state = await getAnalysis({
      ...baseOpts(),
      transport: { fetchComment: async () => { throw new Error('network request failed'); } },
      cache: memoryCache(seed),
    });
    expect(state).toEqual({
      kind: 'stale',
      comment: '지난 분석: 영어를 더 해봐요.',
      generatedAtWall: 111,
      error: 'offline',
      source: 'llm',
    });
  });

  it('server error WITHOUT a cache => fallback-only with the on-device template', async () => {
    const state = await getAnalysis({
      ...baseOpts(),
      transport: { fetchComment: async () => { throw new Error('HTTP 500'); } },
      cache: memoryCache(),
    });
    expect(state.kind).toBe('fallback-only');
    if (state.kind === 'fallback-only') {
      expect(state.error).toBe('server');
      expect(state.comment).toContain('수학'); // deterministic template mentions the deficit subject
    }
  });

  it('a hanging request is aborted after timeoutMs => timeout error, template shown', async () => {
    let abortSeen = false;
    const state = await getAnalysis({
      ...baseOpts(),
      timeoutMs: 20,
      transport: {
        fetchComment: (_facts, signal) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => {
              abortSeen = true;
              reject(signal.reason ?? new Error('aborted'));
            });
          }),
      },
      cache: memoryCache(),
    });
    expect(abortSeen).toBe(true);
    expect(state.kind).toBe('fallback-only');
    if (state.kind === 'fallback-only') expect(state.error).toBe('timeout');
  });

  it('timeout WITH a cache => stale (not fallback)', async () => {
    const seed: CachedAnalysis = {
      facts: {} as AnalysisFacts, comment: '캐시된 코멘트', generatedAtWall: 222, source: 'llm',
    };
    const state = await getAnalysis({
      ...baseOpts(),
      timeoutMs: 10,
      transport: { fetchComment: (_f, s) => new Promise((_r, rej) => s.addEventListener('abort', () => rej(s.reason))) },
      cache: memoryCache(seed),
    });
    expect(state).toMatchObject({ kind: 'stale', error: 'timeout', comment: '캐시된 코멘트' });
  });
});
