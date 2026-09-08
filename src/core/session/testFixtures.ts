import type { ClockStamp } from '../time/clock';
import { localDateOf } from '../time/dayAttribution';
import { SCHEMA_VERSION, type Session } from './types';

export function stamp(partial: Partial<ClockStamp> & { wall: number }): ClockStamp {
  return {
    wall: partial.wall,
    monotonic: partial.monotonic ?? partial.wall,
    bootId: partial.bootId ?? 'boot-1',
    tzId: partial.tzId ?? 'Asia/Seoul',
    tzOffsetMin: partial.tzOffsetMin ?? 540,
  };
}

export function makeSession(over: Partial<Session> & { start: ClockStamp }): Session {
  return {
    id: over.id ?? 'sess-1',
    ownerId: 'local',
    subjectId: over.subjectId ?? null,
    status: over.status ?? 'running',
    start: over.start,
    endWall: over.endWall ?? null,
    plannedMs: over.plannedMs ?? null,
    pauses: over.pauses ?? [],
    focusSelfRating: over.focusSelfRating ?? null,
    startSource: over.startSource ?? 'button',
    endSource: over.endSource ?? null,
    screenTouchedDuringSession: over.screenTouchedDuringSession ?? false,
    clockAnomaly: over.clockAnomaly ?? false,
    attributedLocalDate:
      over.attributedLocalDate ?? localDateOf(over.start.wall, over.start.tzOffsetMin),
    schemaVersion: SCHEMA_VERSION,
    createdAt: over.createdAt ?? over.start.wall,
    updatedAt: over.updatedAt ?? over.start.wall,
  };
}

export const MIN = 60_000;
export const HOUR = 60 * MIN;
