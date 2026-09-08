import type { AnalysisFacts } from './facts';

/**
 * A fully on-device, deterministic Korean comment built by string interpolation
 * from `AnalysisFacts`. Used when the LLM call has never succeeded, so there is
 * always *something* to show. The LLM version is a nicety layered on top.
 */
export function buildTemplateComment(facts: AnalysisFacts): string {
  const withDeficit = facts.subjects
    .map((s) => ({
      ...s,
      deficit: s.targetMinutes > 0 ? (s.targetMinutes - s.actualMinutes) / s.targetMinutes : 0,
    }))
    .filter((s) => s.deficit > 0.15)
    .sort((a, b) => b.deficit - a.deficit);

  const parts: string[] = [];

  if (facts.streakCurrent >= 3) {
    parts.push(`${facts.streakCurrent}일 연속 출석 중이에요.`);
  }

  if (withDeficit.length === 0) {
    parts.push('이번 주 과목별 목표를 잘 따라가고 있어요. 이대로 유지해봐요.');
    return parts.join(' ');
  }

  const worst = withDeficit[0]!;
  const pct = Math.round(worst.deficit * 100);
  parts.push(`${worst.label}이(가) 최근 ${facts.windowDays}일 목표보다 ${pct}% 부족해요.`);

  if (worst.missedDayCount >= 2) {
    parts.push(`최근 ${worst.missedDayCount}일 연속 ${worst.label} 세션이 없었어요.`);
  } else if (worst.lastSessionDaysAgo != null && worst.lastSessionDaysAgo >= 2) {
    parts.push(`마지막 ${worst.label} 세션이 ${worst.lastSessionDaysAgo}일 전이었어요.`);
  }

  if (withDeficit.length > 1) {
    const others = withDeficit.slice(1, 3).map((s) => s.label).join(', ');
    parts.push(`${others}도 목표에 못 미쳤어요.`);
  }

  return parts.join(' ');
}
