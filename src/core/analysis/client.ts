import {
  buildAnalysisFacts,
  isInsufficient,
  type BuildFactsParams,
  type AnalysisFacts,
  type InsufficientData,
} from './facts';
import { buildTemplateComment } from './templateFallback';

/**
 * AI analysis client — orchestrates: build facts -> guard -> call backend with
 * timeout -> cache success -> degrade gracefully on failure.
 *
 * Failure never blocks the screen and never shows an infinite spinner:
 *   - have a cached comment  -> show it, labelled stale, with an error kind
 *   - no cache               -> show the deterministic on-device template
 */

export interface CachedAnalysis {
  facts: AnalysisFacts;
  comment: string;
  generatedAtWall: number;
  source: 'llm' | 'template-fallback';
}

export interface AnalysisTransport {
  /** POST facts to the backend; resolve with the LLM comment. Reject/throw on failure. */
  fetchComment(facts: AnalysisFacts, signal: AbortSignal): Promise<string>;
}

export interface AnalysisCache {
  read(): CachedAnalysis | null;
  write(value: CachedAnalysis): void;
}

export type AnalysisError = 'offline' | 'timeout' | 'server';

export type AnalysisViewState =
  | { kind: 'collecting'; info: InsufficientData }
  | { kind: 'fresh'; comment: string; generatedAtWall: number }
  | {
      kind: 'stale';
      comment: string;
      generatedAtWall: number;
      error: AnalysisError;
      source: 'llm' | 'template-fallback';
    }
  | { kind: 'fallback-only'; comment: string; error: AnalysisError };

export interface GetAnalysisOptions extends BuildFactsParams {
  transport: AnalysisTransport;
  cache: AnalysisCache;
  timeoutMs?: number;
  /** injectable for tests; defaults to real timers */
  scheduler?: {
    setTimeout: (fn: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

function abortError(): Error {
  const e = new Error('The operation was aborted.');
  e.name = 'AbortError';
  return e;
}

export async function getAnalysis(opts: GetAnalysisOptions): Promise<AnalysisViewState> {
  const facts = buildAnalysisFacts(opts);
  if (isInsufficient(facts)) {
    return { kind: 'collecting', info: facts };
  }

  const timeoutMs = opts.timeoutMs ?? 6_000;
  const timers =
    opts.scheduler ??
    ({
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
      clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
    } as const);

  const controller = new AbortController();
  let timedOut = false;
  const timer = timers.setTimeout(() => {
    timedOut = true;
    controller.abort(abortError());
  }, timeoutMs);

  try {
    const comment = await opts.transport.fetchComment(facts, controller.signal);
    timers.clearTimeout(timer);
    const entry: CachedAnalysis = {
      facts,
      comment,
      generatedAtWall: facts.generatedAtWall,
      source: 'llm',
    };
    opts.cache.write(entry);
    return { kind: 'fresh', comment, generatedAtWall: entry.generatedAtWall };
  } catch (err) {
    timers.clearTimeout(timer);
    const error = classifyError(err, timedOut || controller.signal.aborted);
    const cached = opts.cache.read();
    if (cached) {
      return {
        kind: 'stale',
        comment: cached.comment,
        generatedAtWall: cached.generatedAtWall,
        error,
        source: cached.source,
      };
    }
    return { kind: 'fallback-only', comment: buildTemplateComment(facts), error };
  }
}

function classifyError(err: unknown, aborted: boolean): AnalysisError {
  if (aborted) return 'timeout';
  const name = err instanceof Error ? err.name : '';
  if (name === 'AbortError') return 'timeout';
  const message = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('offline') ||
    message.includes('enotfound')
  ) {
    return 'offline';
  }
  return 'server';
}
