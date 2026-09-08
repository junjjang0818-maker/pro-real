import { SCHEMA_VERSION, type Session } from '../session/types';
import type { LocalDate } from '../time/dayAttribution';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
const SEOUL = 540;

let counter = 0;

/** A completed session of `durationMs`, starting at `hh:mm` local on `date`. */
export function completedOn(
  date: LocalDate,
  durationMs: number,
  opts: {
    subjectId?: string | null;
    startHour?: number;
    startMin?: number;
    tzOffsetMin?: number;
    startSource?: Session['startSource'];
    screenTouched?: boolean;
    status?: 'completed' | 'recovered';
    id?: string;
  } = {},
): Session {
  const tzOffsetMin = opts.tzOffsetMin ?? SEOUL;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const startHour = opts.startHour ?? 10;
  const startMin = opts.startMin ?? 0;
  // local wall -> UTC epoch
  const startWall = Date.UTC(y, m - 1, d, startHour, startMin) - tzOffsetMin * 60_000;
  const id = opts.id ?? `s${++counter}`;
  return {
    id,
    ownerId: 'local',
    subjectId: opts.subjectId ?? null,
    status: opts.status ?? 'completed',
    start: { wall: startWall, monotonic: startWall, bootId: 'boot-1', tzId: 'Asia/Seoul', tzOffsetMin },
    endWall: startWall + durationMs,
    plannedMs: null,
    pauses: [],
    focusSelfRating: null,
    startSource: opts.startSource ?? 'button',
    endSource: 'button',
    screenTouchedDuringSession: opts.screenTouched ?? (opts.startSource !== 'gesture'),
    clockAnomaly: false,
    attributedLocalDate: date,
    schemaVersion: SCHEMA_VERSION,
    createdAt: startWall,
    updatedAt: startWall + durationMs,
  };
}

export function resetIds(): void {
  counter = 0;
}
