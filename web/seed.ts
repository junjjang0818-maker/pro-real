import { webKeyValueStore } from '@app/native/web/webKeyValueStore';
import { SCHEMA_VERSION, type Session } from '@app/core/session/types';
import { localDateOf } from '@app/core/time/dayAttribution';

/**
 * Writes ~3 weeks of plausible completed sessions straight into the KV store so
 * the demo has a populated heatmap / streak / analysis on first look. Reloads
 * after writing so the store picks them up on construction.
 */
export function seedDemoData(): void {
  const kv = webKeyValueStore('gst');
  const tz = -new Date().getTimezoneOffset();
  const now = Date.now();
  const dayMs = 86_400_000;
  const subjectsCycle = ['kor', 'math', 'eng', 'soc', 'sci', 'hist'];
  const sessions: Session[] = [];
  let n = 0;

  for (let d = 21; d >= 0; d--) {
    // skip a couple of days to make the streak/freeze logic visible
    if (d === 5 || d === 12 || d === 13) continue;
    const dayStart = now - d * dayMs;
    const blocks = 2 + ((d * 7) % 2); // 2..3 sessions/day -> most days clear the 60-min goal
    for (let b = 0; b < blocks; b++) {
      const startWall = dayStart - (10 - b * 2) * 3600_000 + (d % 4) * 5 * 60_000;
      const durMin = [35, 45, 40, 30][(d + b) % 4]!;
      const subjectId = subjectsCycle[(d + b) % subjectsCycle.length]!;
      const gesture = (d + b) % 3 === 0;
      sessions.push({
        id: `seed_${++n}`,
        ownerId: 'local',
        subjectId,
        status: 'completed',
        start: { wall: startWall, monotonic: startWall, bootId: 'seed', tzId: 'local', tzOffsetMin: tz },
        endWall: startWall + durMin * 60_000,
        plannedMs: null,
        pauses: [],
        focusSelfRating: (((d + b) % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        startSource: gesture ? 'gesture' : 'button',
        endSource: gesture ? 'gesture' : 'button',
        screenTouchedDuringSession: !gesture,
        clockAnomaly: false,
        attributedLocalDate: localDateOf(startWall, tz),
        schemaVersion: SCHEMA_VERSION,
        createdAt: startWall,
        updatedAt: startWall + durMin * 60_000,
      });
    }
  }

  kv.set('sessions.v1', JSON.stringify(sessions));
  kv.delete('active-snapshot.v1');
  kv.delete('awarded-badges.v1');
  // backdate the install date so the AI-analysis data-sufficiency guard passes
  const first = new Date(now - 22 * dayMs);
  kv.set(
    'install-date.v1',
    `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`,
  );
  location.reload();
}

export function resetDemoData(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith('gst:') || k.startsWith('analysis:'))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  location.reload();
}
