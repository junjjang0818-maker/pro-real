import type { ForegroundTimer } from '../ports';
import { computeElapsed } from '../../core/session/elapsed';

/**
 * Web analogue of the OS timer surface. There is no notification tray to own,
 * so this ticks the document title from timestamps (never an accumulator) and,
 * if the user granted permission, shows a Notification at the planned end.
 *
 * `capabilities().exactBackground` is false — a backgrounded tab is throttled by
 * the browser exactly like a backgrounded app; the value is always recomputed
 * from `startWall` when the tab is foregrounded again.
 */
export function webForegroundTimer(): ForegroundTimer {
  let interval: ReturnType<typeof setInterval> | null = null;
  let baseTitle = typeof document !== 'undefined' ? document.title : '';
  let plannedNotified = false;

  const stop = () => {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }
    if (typeof document !== 'undefined') document.title = baseTitle;
  };

  const render = (startWall: number, plannedMs: number | null, paused: boolean) => {
    if (typeof document === 'undefined') return;
    const now = Date.now();
    const { countedMs } = computeElapsed(
      {
        start: { wall: startWall, monotonic: 0, bootId: 'web', tzId: 'UTC', tzOffsetMin: 0 },
        pauses: [],
        endWall: null,
      },
      { wall: now, monotonic: now - startWall, bootId: 'web', tzId: 'UTC', tzOffsetMin: 0 },
    );
    const mmss = (ms: number) => {
      const s = Math.max(0, Math.floor(ms / 1000));
      return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    const tag = paused ? '⏸' : '▶';
    if (plannedMs != null) {
      const remaining = Math.max(0, plannedMs - countedMs);
      document.title = `${tag} ${mmss(remaining)} 남음 · 학습 타이머`;
      if (remaining === 0 && !plannedNotified && !paused) {
        plannedNotified = true;
        notify('목표 시간 완료', '계획한 학습 시간을 채웠어요.');
      }
    } else {
      document.title = `${tag} ${mmss(countedMs)} · 학습 타이머`;
    }
  };

  return {
    async begin({ startWall, plannedMs }) {
      if (typeof document !== 'undefined') baseTitle = stripTag(document.title);
      plannedNotified = false;
      stop();
      render(startWall, plannedMs, false);
      interval = setInterval(() => render(startWall, plannedMs, false), 1000);
    },
    async update({ startWall, plannedMs, paused }) {
      stop();
      render(startWall, plannedMs, paused);
      if (!paused) interval = setInterval(() => render(startWall, plannedMs, false), 1000);
    },
    async end() {
      stop();
    },
    capabilities: () => ({
      liveTick: true,
      exactBackground: false,
      note: '웹: 문서 제목으로 실시간 표시. 백그라운드 탭은 브라우저가 스로틀링하며, 포그라운드 복귀 시 타임스탬프로 재계산합니다.',
    }),
  };
}

function stripTag(title: string): string {
  return title.replace(/^[▶⏸]\s+\S+\s+(남음\s+·|·)\s+/u, '').trim() || title;
}

function notify(title: string, body: string): void {
  try {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  } catch {
    /* ignore */
  }
}
