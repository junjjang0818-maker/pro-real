/**
 * "Day" definition — the single place this rule lives (see docs/02-architecture.md §2.3).
 *
 *  1. A session is attributed to the LOCAL CALENDAR DATE of its `startedAt`,
 *     using the timezone offset that was active WHEN THE SESSION STARTED
 *     (stored on the session as `start.tzOffsetMin`).
 *  2. A session that crosses local midnight counts ENTIRELY toward its start
 *     date. We never split a session in two.
 *  3. Past sessions are NEVER re-attributed when the device timezone later
 *     changes (travel), because we always use the stored start offset, never
 *     "now".
 *
 * All streak / attendance math operates on these "YYYY-MM-DD" local date
 * strings, which sort lexicographically, so timezone travel can at worst cost
 * a streak-freeze — it can never silently corrupt the streak.
 */

export type LocalDate = string; // "YYYY-MM-DD"

/** Local calendar date for an instant, given the offset (minutes east of UTC). */
export function localDateOf(wallMs: number, tzOffsetMin: number): LocalDate {
  const shifted = new Date(wallMs + tzOffsetMin * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Local wall-clock minutes-since-midnight for an instant (0..1439). */
export function localMinutesOfDay(wallMs: number, tzOffsetMin: number): number {
  const shifted = new Date(wallMs + tzOffsetMin * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function crossesLocalMidnight(
  startWall: number,
  endWall: number,
  tzOffsetMin: number,
): boolean {
  return localDateOf(startWall, tzOffsetMin) !== localDateOf(endWall, tzOffsetMin);
}

/** Add (or subtract) whole days to a local date string. */
export function addLocalDays(date: LocalDate, delta: number): LocalDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return localDateOf(dt.getTime(), 0);
}

/** `a - b` in whole days. */
export function diffLocalDays(a: LocalDate, b: LocalDate): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / 86_400_000,
  );
}

export function compareLocalDate(a: LocalDate, b: LocalDate): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of local dates from `from` to `to`. Empty if from > to. */
export function localDateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  const n = diffLocalDays(to, from);
  for (let i = 0; i <= n; i++) out.push(addLocalDays(from, i));
  return out;
}
