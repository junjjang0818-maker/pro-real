import { describe, it, expect } from 'vitest';
import {
  decideNotification,
  DEFAULT_THROTTLER_CONFIG,
  type ThrottleRequest,
  type SentRecord,
} from './notificationThrottler';

const SEOUL = 540;
const HOUR = 3_600_000;

/** 2026-09-08 `hh:mm` Seoul as epoch ms. */
function seoul(hh: number, mm = 0): number {
  return Date.UTC(2026, 8, 8, hh, mm) - SEOUL * 60_000;
}

function req(over: Partial<ThrottleRequest>): ThrottleRequest {
  return {
    nowWall: seoul(12),
    tzOffsetMin: SEOUL,
    pendingBadgeIds: ['b1'],
    history: [],
    ...over,
  };
}

describe('decideNotification', () => {
  it('sends when nothing was sent recently and we are within limits', () => {
    const d = decideNotification(req({}));
    expect(d).toEqual({ action: 'send', badgeIds: ['b1'], title: '뱃지를 획득했어요!' });
  });

  it('titles a multi-badge send in the plural', () => {
    const d = decideNotification(req({ pendingBadgeIds: ['b1', 'b2', 'b2', 'b3'] }));
    expect(d).toMatchObject({ action: 'send', badgeIds: ['b1', 'b2', 'b3'], title: '뱃지 3개를 획득했어요!' });
  });

  it('batches into a very recent send instead of pushing again', () => {
    const history: SentRecord[] = [{ atWall: seoul(12) - 30_000, count: 1 }];
    const d = decideNotification(req({ history, pendingBadgeIds: ['b2'] }));
    expect(d).toEqual({ action: 'batch-into-recent', badgeIds: ['b2'] });
  });

  it('defers on the min-gap rule (recent-but-not-batchable send)', () => {
    const lastAt = seoul(12) - 30 * 60_000; // 30 min ago (< 3h gap, > batch window)
    const d = decideNotification(req({ history: [{ atWall: lastAt, count: 1 }] }));
    expect(d).toMatchObject({ action: 'defer', reason: 'min-gap', retryAtWall: lastAt + DEFAULT_THROTTLER_CONFIG.minGapMs });
  });

  it('defers once the daily cap is reached', () => {
    const history: SentRecord[] = [
      { atWall: seoul(6), count: 1 },
      { atWall: seoul(9), count: 1 },
    ];
    const d = decideNotification(req({ history }));
    expect(d).toMatchObject({ action: 'defer', reason: 'daily-cap' });
  });

  it('counts the cap per LOCAL day (yesterday does not count)', () => {
    const history: SentRecord[] = [
      { atWall: seoul(12) - 20 * HOUR, count: 1 },
      { atWall: seoul(12) - 26 * HOUR, count: 1 },
    ];
    // both are > 3h ago and on a previous local day -> today is clear
    const d = decideNotification(req({ history }));
    expect(d.action).toBe('send');
  });

  it('defers during quiet hours to the window opening', () => {
    const d = decideNotification(req({ nowWall: seoul(23, 30) }));
    expect(d.action).toBe('defer');
    if (d.action === 'defer') {
      expect(d.reason).toBe('quiet-hours');
      // 08:00 next day Seoul
      expect(d.retryAtWall).toBe(Date.UTC(2026, 8, 9, 8, 0) - SEOUL * 60_000);
    }
  });

  it('no pending badges => nothing to send', () => {
    expect(decideNotification(req({ pendingBadgeIds: [] })).action).toBe('defer');
  });
});
