import { useEffect, useReducer } from 'react';
import { app, subjects, subscribeSettings } from './appInstance';
import { subscribeCalibration } from './calibration';

/** Re-render on any store / subjects / settings / calibration change, plus a
 *  wall tick so the live elapsed time (always derived from timestamps) stays fresh. */
export function useAppSync(tickMs = 500): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const unsubs = [
      app.store.subscribe(bump),
      subjects.subscribe(bump),
      subscribeSettings(bump),
      subscribeCalibration(bump),
    ];
    const id = setInterval(bump, tickMs);
    return () => {
      for (const u of unsubs) u();
      clearInterval(id);
    };
  }, [tickMs]);
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** mm:ss.cs — seconds to two decimal places (centiseconds). */
export function mmssCs(ms: number): string {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const cs = Math.floor((t % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function hm(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}시간 ${m % 60}분` : `${m}분`;
}
