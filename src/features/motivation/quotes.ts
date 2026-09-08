import { diffLocalDays, type LocalDate } from '../../core/time/dayAttribution';
import type { StreakResult } from '../../core/derivations/streak';
import type { SubjectStat } from '../../core/derivations/subjectStats';

/**
 * Motivation copy provider.
 *   - builtin  : bundled quote rotation, deterministic per local date (stable
 *                within a day, changes at local midnight)
 *   - dataDriven: interpolates streak / deficit facts; suppressed when data is
 *                 insufficient (same guard spirit as AI analysis)
 *   - userGoal : sentences the user typed themselves
 * The user chooses which sources are enabled and their weighting.
 */

export interface Quote {
  text: string;
  source: 'builtin' | 'data-driven' | 'user-goal';
  author?: string;
}

export interface QuoteSourceConfig {
  builtin: boolean;
  dataDriven: boolean;
  userGoal: boolean;
}

export const DEFAULT_QUOTE_SOURCES: QuoteSourceConfig = {
  builtin: true,
  dataDriven: true,
  userGoal: true,
};

export const BUILTIN_QUOTES: ReadonlyArray<{ text: string; author: string }> = [
  { text: '오늘 걷지 않으면 내일은 뛰어야 한다.', author: '작자 미상' },
  { text: '작은 진전도 진전이다.', author: '작자 미상' },
  { text: '시작이 반이다.', author: '아리스토텔레스' },
  { text: '집중은 거절의 연속이다.', author: '스티브 잡스' },
  { text: '천 리 길도 한 걸음부터.', author: '노자' },
  { text: '오늘 할 수 있는 일에 전력을 다하라.', author: '아이작 뉴턴' },
  { text: '반복이 실력을 만든다.', author: '작자 미상' },
];

export interface QuoteContext {
  today: LocalDate;
  installDate: LocalDate;
  streak: StreakResult;
  subjectStats: SubjectStat[];
  userGoals: string[];
  sources?: QuoteSourceConfig;
  /** distinct study days so far — gates data-driven lines. */
  distinctStudyDays: number;
}

const DATA_DRIVEN_MIN_DAYS = 3;

/** Deterministic pick of the day's builtin quote. */
export function builtinQuoteForDate(today: LocalDate, installDate: LocalDate): Quote {
  const idx = Math.abs(diffLocalDays(today, installDate)) % BUILTIN_QUOTES.length;
  const q = BUILTIN_QUOTES[idx]!;
  return { text: q.text, author: q.author, source: 'builtin' };
}

export function dataDrivenQuotes(ctx: QuoteContext): Quote[] {
  if (ctx.distinctStudyDays < DATA_DRIVEN_MIN_DAYS) return [];
  const out: Quote[] = [];

  if (ctx.streak.current >= 3) {
    out.push({
      text: `${ctx.streak.current}일 연속 출석 중이에요. 오늘도 이어가 봐요.`,
      source: 'data-driven',
    });
  }
  if (ctx.streak.current >= 1 && !ctx.streak.todayAttended) {
    out.push({
      text: `오늘 목표를 채우면 ${ctx.streak.current + 1}일 연속이에요.`,
      source: 'data-driven',
    });
  }

  const worst = [...ctx.subjectStats]
    .filter((s) => s.deficitPct > 0.2)
    .sort((a, b) => b.deficitPct - a.deficitPct)[0];
  if (worst) {
    const pct = Math.round(worst.deficitPct * 100);
    out.push({
      text: `${worst.label}이(가) 목표보다 ${pct}% 부족해요. 30분만 투자해 볼까요?`,
      source: 'data-driven',
    });
  }
  return out;
}

/** Build the ordered candidate pool for the given context and source config. */
export function quotePool(ctx: QuoteContext): Quote[] {
  const sources = ctx.sources ?? DEFAULT_QUOTE_SOURCES;
  const pool: Quote[] = [];
  if (sources.userGoal) {
    for (const g of ctx.userGoals.map((s) => s.trim()).filter(Boolean)) {
      pool.push({ text: g, source: 'user-goal' });
    }
  }
  if (sources.dataDriven) pool.push(...dataDrivenQuotes(ctx));
  if (sources.builtin) pool.push(builtinQuoteForDate(ctx.today, ctx.installDate));
  // never empty: fall back to a builtin even if all sources are disabled
  if (pool.length === 0) pool.push(builtinQuoteForDate(ctx.today, ctx.installDate));
  return pool;
}

/** The single quote to show now — deterministic for a given day + pool. */
export function pickQuote(ctx: QuoteContext): Quote {
  const pool = quotePool(ctx);
  const idx = Math.abs(diffLocalDays(ctx.today, ctx.installDate)) % pool.length;
  return pool[idx]!;
}
